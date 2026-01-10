const { onRequest } = require('firebase-functions/v2/https');
const { onTaskDispatched } = require('firebase-functions/v2/tasks');
const admin = require('firebase-admin');
const { VertexAI } = require('@google-cloud/vertexai');
const fs = require('fs');
const path = require('path');

admin.initializeApp();

// Initialize Vertex AI
const vertex_ai = new VertexAI({ project: 'questio-2dd69', location: 'us-central1' });
const model = 'gemini-1.5-flash';

// Load Problems from CSV (Cold Start)
const problemsMap = new Map();
try {
    const csvPath = path.join(__dirname, 'sampleProbs.csv');
    const csvContent = fs.readFileSync(csvPath, 'utf-8');
    const rows = csvContent.trim().split('\n').slice(1);

    rows.forEach((row, index) => {
        // Robust split similar to frontend
        const cols = row.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);

        // Map new schema: 
        // 0: University, 1: Year, 2: Question Type, 3: Prob URL, 4: Sol URL
        // Previous: id, univ, year, subject, question, crit_form, crit_logic, model

        // Generate pseudo ID
        const id = `Q${String(index + 1).padStart(3, '0')}`;

        if (cols.length >= 3) {
            problemsMap.set(id, {
                id: id,
                subject: "수리논술", // Default
                question: cols[2]?.replace(/"/g, '') || "논술 문제",
                // Fallback Generic Criteria
                criteria_formula: "수학적 계산의 정확성 및 공식 적용의 올바름 (General Math Rules)",
                criteria_logic: "논리적 전개 과정 및 근거의 타당성 (Logical Consistency)",
                model_answer: "참조 링크 확인 (Refer to Solution URL)"
            });
        }
    });
    console.log(`Loaded ${problemsMap.size} problems.`);
} catch (e) {
    console.error("Failed to load problems.csv:", e);
}

// Helper: Call Gemini
async function callGemini(systemInstruction, userPrompt, imagePart, config = {}) {
    try {
        const generationConfig = {
            'maxOutputTokens': 8192,
            'temperature': 0.4,
            'topP': 0.95,
            ...config // Merge custom config (e.g. responseMimeType)
        };

        const generativeModel = vertex_ai.preview.getGenerativeModel({
            model: model,
            generationConfig: generationConfig,
            systemInstruction: {
                parts: [{ text: systemInstruction }]
            },
        });

        const contentParts = [{ text: userPrompt }];
        if (imagePart) {
            contentParts.push({ inlineData: imagePart });
        }

        const req = {
            contents: [{ role: 'user', parts: contentParts }],
        };

        const streamingResp = await generativeModel.generateContentStream(req);
        const aggregatedResponse = await streamingResp.response;
        const text = aggregatedResponse.candidates[0].content.parts[0].text;

        // JSON Parsing
        if (config.responseMimeType === 'application/json') {
            return JSON.parse(text);
        }

        const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonMatch && jsonMatch[1]) {
            return JSON.parse(jsonMatch[1]);
        }
        if (text.trim().startsWith('{')) {
            return JSON.parse(text);
        }
        return { text: text };

    } catch (e) {
        console.error("Gemini Error:", e);
        return { error: "AI Generation Failed", details: e.message };
    }
}

// 1. HTTP API: Submit Answer & Fan-out Tasks
exports.submitAnswer = onRequest({ cors: true }, async (req, res) => {
    // CORS is handled automatically by { cors: true }
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }

    try {
        const { problemId, studentName, imageUrl, criteria } = req.body;
        console.log(`[API] Received submission for ${problemId} from ${studentName}`);

        if (!imageUrl) {
            return res.status(400).json({ error: "Image URL is required" });
        }

        const db = admin.firestore();
        const ticketRef = db.collection('grading_tickets').doc();
        const ticketId = ticketRef.id;

        // Initialize Ticket
        await ticketRef.set({
            ticketId: ticketId,
            problemId: problemId,
            studentName: studentName || "Anonymous",
            status: "processing",
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            tasks: {
                formula: { status: 'pending' },
                logic: { status: 'pending' },
                feedback: { status: 'pending' }
            },
            result: {}
        });

        // Fan-out: Dispatch 3 Cloud Tasks
        const project = 'questio-2dd69';
        const location = 'us-central1';
        const queue = 'grading-queue';
        const tasksClient = new Data(project, location); // Placeholder if needed, but we use functions.task.dispatch
        // Actually we use the onTaskDispatched mechanism. 
        // We need to enqueue tasks using Google Cloud Tasks Client or similar.
        // Simplified for this architecture: Trigger via simple HTTP or PubSub? 
        // Wait, the original design used a Queue-based approach or direct triggers.
        // Let's use the standard "enqueue" helper if available, or just call the worker directly?
        // NO, we defined `onTaskDispatched`. We must enqueue tasks to the specific queue.

        const { CloudTasksClient } = require('@google-cloud/tasks');
        const tasksClientV2 = new CloudTasksClient();
        const parent = tasksClientV2.queuePath(project, location, queue);

        const dispatchTask = async (type) => {
            const task = {
                httpRequest: {
                    httpMethod: 'POST',
                    url: `https://${location}-${project}.cloudfunctions.net/processGradingTask`, // URL of the worker
                    headers: { 'Content-Type': 'application/json' },
                    body: Buffer.from(JSON.stringify({
                        ticketId, taskType: type, imageUrl, problemId, criteria
                    })).toString('base64'),
                    oidcToken: {
                        serviceAccountEmail: `questio-2dd69@appspot.gserviceaccount.com`,
                    },
                },
            };
            await tasksClientV2.createTask({ parent, task });
        };

        await Promise.all([
            dispatchTask('formula'),
            dispatchTask('logic'),
            dispatchTask('feedback')
        ]);

        res.status(200).json({ ticketId: ticketId, message: "Use ticketId to listen for results." });

    } catch (error) {
        console.error("API Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// Helper Functions for processGradingTask
// ============================================================================

/**
 * Parses image data from a data URL
 * @param {string} imageUrl - Data URL containing base64 encoded image
 * @returns {object|null} Image part object with mimeType and data, or null if invalid
 */
function parseImageData(imageUrl) {
    if (!imageUrl || !imageUrl.startsWith('data:')) {
        return null;
    }

    const matches = imageUrl.match(/^data:(.+);base64,(.+)$/);
    if (!matches) {
        return null;
    }

    return { mimeType: matches[1], data: matches[2] };
}

/**
 * Prepares problem context with custom criteria if provided
 * @param {string} problemId - ID of the problem
 * @param {string} criteria - Custom criteria (optional)
 * @returns {object} Problem object with question, criteria, and model answer
 */
function prepareProblemContext(problemId, criteria) {
    let problem = problemsMap.get(problemId) || {
        question: "Unknown Question",
        criteria_formula: "General Math Rules",
        criteria_logic: "Logical consistency",
        model_answer: "N/A"
    };

    if (criteria && criteria.trim() !== "") {
        problem = {
            ...problem,
            criteria_formula: `[Custom Context Provided]:\n${criteria}`,
            criteria_logic: `[Custom Context Provided]:\n${criteria}`
        };
    }

    return problem;
}

/**
 * Processes formula grading task using AI
 * @param {object} problem - Problem context object
 * @param {object} imagePart - Parsed image data
 * @returns {Promise<object>} AI result with formula analysis
 */
async function processFormulaTask(problem, imagePart) {
    const jsonConfig = { responseMimeType: 'application/json' };

    return await callGemini(
        "You are a strict math grader. Verify if the solution matches the given [Question] first.",
        `
        [Question]: ${problem.question}
        [Model Answer]: ${problem.model_answer}
        [Grading Criteria]: ${problem.criteria_formula}

        Analyze the student's solution provided in the image.
        1. **CRITICAL STEP**: Does the student's solution address the [Question] above?
           - If NO (different problem): Set "valid": false, "score_deduction": 100, "errors": ["Wrong problem solved", "Irrelevant solution"].
           - If YES: Continue grading.

        2. Extract formulas used.
        3. Check specific steps against Model Answer.

        Output JSON: {
            "valid": boolean,
            "is_correct_problem": boolean,
            "latex": "extracted latex",
            "errors": ["error 1", ...],
            "score_deduction": number
        }
        `,
        imagePart,
        jsonConfig
    );
}

/**
 * Processes logic grading task using AI
 * @param {object} problem - Problem context object
 * @param {object} imagePart - Parsed image data
 * @returns {Promise<object>} AI result with logic analysis
 */
async function processLogicTask(problem, imagePart) {
    const jsonConfig = { responseMimeType: 'application/json' };

    return await callGemini(
        "You are a logic analyst. Check for logical jumps or insufficient grounding.",
        `
        [Question]: ${problem.question}
        [Grading Criteria]: ${problem.criteria_logic}

        Analyze the flow of the argument.
        - Are step transitions valid?

        Output JSON: { "structure": "Valid"|"Invalid", "gaps": ["gap description"], "score_deduction": number }
        `,
        imagePart,
        jsonConfig
    );
}

/**
 * Processes feedback generation task using AI
 * @param {object} problem - Problem context object
 * @param {object} imagePart - Parsed image data
 * @returns {Promise<object>} AI result with feedback
 */
async function processFeedbackTask(problem, imagePart) {
    const jsonConfig = { responseMimeType: 'application/json' };

    return await callGemini(
        "You are a warm, encouraging AI tutor 'Dr. Han'. Use Korean.",
        `
        [Question]: ${problem.question}
        [Criteria]: ${problem.criteria_logic}

        Analyze the student's detailed performance.
        1. **Context Check**: Is this the correct problem?
        2. Identify **Strengths** (What they did well).
        3. Identify **Weaknesses** (What they missed).
        4. Suggest **Study Points** (What logic/concept to review).
        5. Provide **Overall Evaluation** summarizing the score.

        Output JSON: {
            "is_correct_problem": boolean,
            "strengths": "Detailed text in Korean",
            "weaknesses": "Detailed text in Korean",
            "study_points": "Detailed text in Korean",
            "overall_eval": "Detailed text in Korean",
            "text": "General encouraging feedback",
            "tone": "encouraging"
        }
        `,
        imagePart,
        jsonConfig
    );
}

/**
 * Calculates final score based on task results
 * @param {object} tasks - All task results
 * @returns {object} Object containing finalScore and any error information
 */
function calculateFinalScore(tasks) {
    // Check for Wrong Problem Penalty (Override score if wrong problem)
    const isWrongProblem = (
        tasks.formula.data.is_correct_problem === false ||
        tasks.feedback.data.is_correct_problem === false
    );

    // Check for AI API Errors (Prevent 100/100 on failure)
    const hasError = (
        tasks.formula.data.error ||
        tasks.logic.data.error ||
        tasks.feedback.data.error
    );

    let logicDeduction = tasks.logic.data.score_deduction || 0;
    let formulaDeduction = tasks.formula.data.score_deduction ||
        (tasks.formula.data.errors ? tasks.formula.data.errors.length * 5 : 0);

    let finalScore = Math.max(0, 100 - logicDeduction - formulaDeduction);

    if (isWrongProblem) {
        finalScore = 0;
        console.log("Penalty: Student solved wrong problem. Score reset to 0.");
    }

    if (hasError) {
        finalScore = 0;
        console.error("Aggregation Canceled: One or more tasks failed with error.");
        // Inject Error Feedback
        tasks.feedback.data = {
            text: "시스템 오류: AI 분석에 실패했습니다. (AI Analysis Failed)",
            strengths: "N/A",
            weaknesses: "AI API Error (Vertex AI 403/500)",
            study_points: "Check Google Cloud Console API Status.",
            overall_eval: "AI 서비스가 비활성화되어 있거나 오류가 발생했습니다.",
            is_correct_problem: false
        };
    }

    return { finalScore, hasError, isWrongProblem };
}

/**
 * Generates HTML report from grading results using AI
 * @param {object} fullResultData - Complete result data including score and all task results
 * @returns {Promise<string>} Generated HTML report
 */
async function generateHtmlReport(fullResultData) {
    const htmlReport = await callGemini(
        "You are a Frontend Developer specializing in Tailwind CSS reports.",
        `
        Convert this Grading Result into a Premium HTML Report.

        [Data]:
        ${JSON.stringify(fullResultData)}

        [Design Requirements]:
        - Use Tailwind CSS.
        - Dark Mode theme (bg-zinc-900 text-gray-200).
        - Use <div class="p-6 bg-[#13111c] rounded-2xl border border-white/5"> for cards.
        - Display Total Score prominently with a gradient text.
        - **CRITICAL**: Create separate sections for:
          1. **Strengths** (Use green accents) from data.feedback.strengths
          2. **Weaknesses** (Use red accents) from data.feedback.weaknesses
          3. **Study Points** (Use blue accents) from data.feedback.study_points
          4. **Overall Evaluation** (Use purple accents) from data.feedback.overall_eval
        - If score is 0 and is_wrong_problem is true, display a LARGE WARNING: "Different Problem Detected".
        - Format LaTeX Math with $...$ (e.g. $\\int x dx$).
        - DO NOT include fully proper HTML structure (<html>, <body>), only the inner container HTML to be injected into a detailed view.

        Output ONLY valid HTML code.
        `,
        null,
        { responseMimeType: 'text/plain' }
    );

    return htmlReport.text;
}

/**
 * Checks if all tasks are complete and aggregates results
 * @param {object} ticketRef - Firestore document reference
 * @param {string} ticketId - Ticket ID for logging
 * @returns {Promise<void>}
 */
async function checkAndAggregateResults(ticketRef, ticketId) {
    const docSnap = await ticketRef.get();
    const tasks = docSnap.data().tasks;

    if (tasks.formula.status === 'completed' &&
        tasks.logic.status === 'completed' &&
        tasks.feedback.status === 'completed') {

        console.log(`[Aggregation] All tasks complete for ${ticketId}. Generating HTML Report...`);

        // Calculate Score
        const scoreResult = calculateFinalScore(tasks);

        // Generate Full Result Data
        const fullResultData = {
            score: scoreResult.finalScore,
            formula: tasks.formula.data,
            logic: tasks.logic.data,
            feedback: tasks.feedback.data
        };

        // Generate HTML Report
        const htmlReportText = await generateHtmlReport(fullResultData);

        // Update Firestore with final results
        await ticketRef.update({
            status: 'completed',
            'result.score': scoreResult.finalScore,
            'result.summary': tasks.feedback.data.text,
            'result.html_report': htmlReportText
        });

        console.log(`[Finalized] Ticket ${ticketId} Score: ${scoreResult.finalScore}`);
    }
}

// ============================================================================
// 2. Cloud Task Worker: Execute Specific Logic via Vertex AI
exports.processGradingTask = onTaskDispatched({
    retryConfig: {
        maxAttempts: 3,
        minBackoffSeconds: 10,
    },
    rateLimits: {
        maxConcurrentDispatches: 10,
    },
}, async (req) => {
    const data = req.data;
    const { ticketId, taskType, imageUrl, problemId, criteria } = data;
    const db = admin.firestore();
    const ticketRef = db.collection('grading_tickets').doc(ticketId);

    console.log(`[Start] Task: ${taskType}, Ticket: ${ticketId}`);

    try {
        // Mark task as processing
        await ticketRef.update({
            [`tasks.${taskType}.status`]: 'processing'
        });

        // Prepare problem context with custom criteria if provided
        const problem = prepareProblemContext(problemId, criteria);

        // Parse image data from URL
        const imagePart = parseImageData(imageUrl);

        // Execute the appropriate task based on type
        let aiResult = {};
        switch (taskType) {
            case 'formula':
                aiResult = await processFormulaTask(problem, imagePart);
                break;
            case 'logic':
                aiResult = await processLogicTask(problem, imagePart);
                break;
            case 'feedback':
                aiResult = await processFeedbackTask(problem, imagePart);
                break;
        }

        // Update task results in Firestore
        await ticketRef.update({
            [`result.${taskType}`]: aiResult,
            [`tasks.${taskType}.status`]: 'completed',
            [`tasks.${taskType}.data`]: aiResult
        });

        // Check if all tasks are complete and aggregate results
        await checkAndAggregateResults(ticketRef, ticketId);

    } catch (error) {
        console.error(`Error in ${taskType}:`, error);
        await ticketRef.update({
            [`tasks.${taskType}.status`]: 'error',
            [`tasks.${taskType}.error`]: error.message
        });
    }
});
// 3. Search Scoring Criteria (Grounding with Google Search)
exports.searchScoringCriteria = onRequest({ cors: true }, async (req, res) => {
    // CORS
    if (req.method === 'OPTIONS') {
        res.set('Access-Control-Allow-Methods', 'POST');
        res.set('Access-Control-Allow-Headers', 'Content-Type');
        res.status(204).send('');
        return;
    }

    const { university, year, problemType } = req.body;
    console.log(`[Search] Criteria for: ${university} ${year} ${problemType}`);

    try {
        const generativeModel = vertex_ai.preview.getGenerativeModel({
            model: model,
            generationConfig: {
                'temperature': 0.7, // Slightly creative for summary
            },
            tools: [{ googleSearchRetrieval: {} }] // Enable Google Search Grounding
        });

        const prompt = `
        Find official scoring criteria and grade distribution for ${university} ${year} ${problemType || "Math Essay"} exam.
        If specific ${year} data is not found, use the most recent year.
        
        Output a concise Korean summary suitable for a grading AI context.
        Structure:
        - [Evaluation Standards]: Key points
        - [Grade Distribution]: If available
        - [Critical Deductions]: Major pitfalls
        
        Format as plain text (no markdown code blocks) so I can paste it into a text area.
        `;

        const reqBody = {
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
        };

        const streamingResp = await generativeModel.generateContentStream(reqBody);
        const aggregatedResponse = await streamingResp.response;
        const text = aggregatedResponse.candidates[0].content.parts[0].text;

        res.status(200).json({ text: text });

    } catch (error) {
        console.error("Search Error:", error);
        res.status(500).json({ error: error.message });
    }
});
