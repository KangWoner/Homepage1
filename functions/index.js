const { onRequest } = require('firebase-functions/v2/https');
const { onTaskDispatched } = require('firebase-functions/v2/tasks');
const admin = require('firebase-admin');
const { VertexAI } = require('@google-cloud/vertexai');
const fs = require('fs');
const path = require('path');

admin.initializeApp();

// Initialize Vertex AI
const vertex_ai = new VertexAI({ project: 'questio-2dd69', location: 'us-central1' });
const model = 'gemini-1.5-pro'; // Upgrade to Pro for deeper reasoning (Song Minsu Persona)

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
        // Local fallback or simplified logging if Tasks client fails logic
        // But we proceed to use CloudTasksClient below.

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
        console.error("[API Error] submitAnswer failed:", error);
        res.status(500).json({
            error: "Backend Execution Failed",
            details: error.message,
            stack: error.stack
        });
    }
});

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

    try {
        await ticketRef.update({
            [`tasks.${taskType}.status`]: 'processing'
        });

        // 1. Prepare Problem Context
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

        // 2. Parse Image
        let imagePart = null;
        if (imageUrl && imageUrl.startsWith('data:')) {
            const matches = imageUrl.match(/^data:(.+);base64,(.+)$/);
            if (matches) {
                imagePart = { mimeType: matches[1], data: matches[2] };
            }
        }

        let aiResult = {};
        const jsonConfig = { responseMimeType: 'application/json' };

        switch (taskType) {
            case 'formula':
                aiResult = await callGemini(
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
                break;

            case 'logic':
                aiResult = await callGemini(
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
                break;

            case 'feedback':
                aiResult = await callGemini(
                    "You are 'Song Minsu', a strict, professional top-tier Math Essay Instructor in South Korea. Your tone is critical, cold, but extremely insightful.",
                    `
                    [Matching Check]: Is the student's solution for the given [Question]?
                    [Question]: ${problem.question}
                    [Criteria]: ${problem.criteria_logic}

                    Analyze the student's solution strictly based on the Model Answer.
                    
                    **Evaluation Strategy**:
                    1. **Core Competencies Scoring (0-100)**:
                       - **Problem Solving (문제해결력)**: Did they interpret the problem correctly and find the right path?
                       - **Writing Ability (논리적 서술)**: Is the derivation clear, logical, and without gaps?
                       - **Calculation (수리 연산)**: Are all intermediate and final calculations correct?
                    
                    2. **Feedback Sections**:
                       - **Strengths**: Acknowledge ONLY true positives.
                       - **Weaknesses**: Point out every logical gap, notation error, or inefficiency.
                       - **Study Points**: Specific mathematical concepts to review.
                       - **Growth Analysis**: Compare this attempt to an ideal 'Previous Attempt' (simulated). Highlight if this shows improvement or recurring bad habits.
                       - **Overall Evaluation**: A strict summary of their level (Top Tier, Mid, Low).

                    Output strictly matching JSON Schema:
                    { 
                        "is_correct_problem": boolean,
                        "coreCompetencies": {
                             "problemSolving": number,
                             "writingAbility": number,
                             "calculationAccuracy": number
                        },
                        "strengths": ["string", "string"], 
                        "weaknesses": ["string", "string"], 
                        "study_points": ["string", "string"],
                        "growth_analysis": "Detailed markdown text comparing to potential past mistakes.",
                        "overall_eval": "Detailed strict markdown text.",
                        "text": "A brief 2-sentence summary for the notifications."
                    }
                    `,
                    imagePart,
                    jsonConfig
                );
                break;
        }

        // Update results
        await ticketRef.update({
            [`result.${taskType}`]: aiResult,
            [`tasks.${taskType}.status`]: 'completed',
            [`tasks.${taskType}.data`]: aiResult
        });

        // Check Completion & Generate Final HTML Report (Step 3)
        const docSnap = await ticketRef.get();
        const tasks = docSnap.data().tasks;

        if (tasks.formula.status === 'completed' &&
            tasks.logic.status === 'completed' &&
            tasks.feedback.status === 'completed') {

            // Calculate Score
            // Check for Wrong Problem Penalty (Override score if wrong problem)
            const isWrongProblem = (tasks.formula.data.is_correct_problem === false || tasks.feedback.data.is_correct_problem === false);

            // Checks for AI API Errors (Prevent 100/100 on failure)
            const hasError = (tasks.formula.data.error || tasks.logic.data.error || tasks.feedback.data.error);

            let logicDeduction = tasks.logic.data.score_deduction || 0;
            let formulaDeduction = tasks.formula.data.score_deduction || (tasks.formula.data.errors ? tasks.formula.data.errors.length * 5 : 0);

            let finalScore = Math.max(0, 100 - logicDeduction - formulaDeduction);

            if (isWrongProblem) {
                finalScore = 0;
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

            // Step 3: Generate Premium HTML Report
            const fullResultData = {
                score: finalScore,
                formula: tasks.formula.data,
                logic: tasks.logic.data,
                feedback: tasks.feedback.data
            };

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
                
                - **CRITICAL: Competency Visualization**:
                  - Display 'Core Competencies' (Problem Solving, Writing, Calculation) using Progress Bars.
                  - Use data.feedback.coreCompetencies.score for width (e.g. w-[80%]).
                
                - **CRITICAL: New Sections**:
                  1. **Growth Analysis** (Use cyan accents): data.feedback.growth_analysis (Render Markdown)
                  2. **Strengths** (Use green accents): data.feedback.strengths
                  3. **Weaknesses** (Use red accents): data.feedback.weaknesses
                  4. **Study Points** (Use blue accents): data.feedback.study_points
                  5. **Overall Evaluation** (Use purple accents): data.feedback.overall_eval
                  
                - If score is 0 and is_wrong_problem is true, display a LARGE WARNING: "Different Problem Detected".
                - Format LaTeX Math with $...$ (e.g. $\\int x dx$).
                - DO NOT include fully proper HTML structure (<html>, <body>), only the inner container HTML to be injected into a detailed view.
                
                Output ONLY valid HTML code.
                `,
                null,
                { responseMimeType: 'text/plain' }
            );

            await ticketRef.update({
                status: 'completed',
                'result.score': finalScore,
                'result.summary': tasks.feedback.data.text,
                'result.html_report': htmlReport.text // Store the HTML
            });
        }

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
