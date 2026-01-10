
window.onerror = function (msg, url, line, col, error) {
    console.error("Global Error:", msg, url, line);
    // alert("System Error: " + msg); // Optional for user visibility
};

// --- GLOBAL UI VARIABLES ---
window.problemsData = [];
window.currentProblemId = null;
window.selectedFiles = [];

// --- ROBUST UI FUNCTIONS (Non-Module) ---

window.toggleStudentInput = function () {
    document.getElementById('studentName').value = '';
    document.getElementById('studentEmail').value = '';
    document.getElementById('studentName').focus();
    const btn = event.currentTarget;
    if (btn) {
        const originalText = btn.innerText;
        btn.innerText = "READY!";
        setTimeout(() => btn.innerText = originalText, 1000);
    }
};

window.handleAnswerUpload = function (input) {
    if (input.files) {
        const grid = document.getElementById('previewGrid');
        const placeholder = document.getElementById('answerPlaceholder');
        window.selectedFiles = Array.from(input.files);

        if (window.selectedFiles.length > 0) {
            placeholder.classList.add('hidden');
            grid.classList.remove('hidden');
            grid.innerHTML = '';
            window.selectedFiles.forEach((file, idx) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const img = document.createElement('img');
                    img.src = e.target.result;
                    img.className = "w-full h-32 object-cover rounded-lg border border-white/10";
                    grid.appendChild(img);
                };
                reader.readAsDataURL(file);
            });
            const btn = document.getElementById('mainActionBtn');
            btn.disabled = false;
            btn.classList.remove('cursor-not-allowed', 'text-gray-600');
            btn.classList.add('hover:bg-blue-600', 'text-white', 'cursor-pointer', 'bg-blue-500');
            btn.innerText = `START SCORING (${window.selectedFiles.length} FILES)`;
        }
    }
};

window.openGradingModal = async function () {
    // DEBUG: REMOVE AFTER VERIFICATION
    alert("DEBUG: Button Clicked! Opening logic starting...");
    console.log("Opening Grading Modal...");

    const modal = document.getElementById('gradingModal');
    if (!modal) {
        alert("CRITICAL ERROR: Modal element 'gradingModal' not found in DOM!");
        return;
    }
    modal.classList.remove('hidden');

    const studentInput = document.getElementById('studentName');
    if (studentInput && !studentInput.value) {
        studentInput.value = "미래의 합격생 (Guest)";
    }

    // Load Data immediately
    console.log("Fetching problems...");
    await window.fetchProblems();
    console.log("Problems fetched.");
};

window.closeGradingModal = function () {
    document.getElementById('gradingModal').classList.add('hidden');
};

window.fetchProblems = async function (file = null) {
    if (file) {
        // Forward to handleCSV for consistency if needed, or parse directly
        // For now, simple file read:
        const reader = new FileReader();
        reader.onload = (e) => {
            window.parseCSV(e.target.result);
            window.filterProblems();
        };
        reader.readAsText(file, 'UTF-8');
        return;
    }

    try {
        const response = await fetch('/sampleProbs.csv');
        if (!response.ok) throw new Error("Failed to load sample CSV");
        const text = await response.text();
        window.parseCSV(text);
        window.filterProblems();
    } catch (e) {
        console.error("CSV Error:", e);
        document.getElementById('problemList').innerHTML = `<div class="text-red-500 text-center">데이터 로드 실패</div>`;
    }
};

window.parseCSV = function (text) {
    if (!text || text.trim() === '') return;
    const rows = [];
    let currentRow = [];
    let currentVal = '';
    let insideQuotes = false;
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const nextChar = text[i + 1];
        if (char === '"') {
            if (insideQuotes && nextChar === '"') { currentVal += '"'; i++; }
            else { insideQuotes = !insideQuotes; }
        } else if (char === ',' && !insideQuotes) {
            currentRow.push(currentVal); currentVal = '';
        } else if (char === '\n' && !insideQuotes) {
            currentRow.push(currentVal);
            if (currentRow.length > 0) rows.push(currentRow);
            currentRow = []; currentVal = '';
        } else { currentVal += char; }
    }
    if (currentVal || currentRow.length > 0) { currentRow.push(currentVal); rows.push(currentRow); }

    if (rows.length < 2) return;
    const headers = rows[0].map(h => h.trim().toLowerCase());
    const findIndex = (keywords) => headers.findIndex(h => keywords.some(k => h.includes(k)));

    const idxId = findIndex(['id', '번호']);
    const idxUnivName = findIndex(['대학교 이름', 'university', 'univ']);
    const idxYearCol = findIndex(['출제 년도', 'year']);
    const idxProbType = findIndex(['문제 유형', 'question', 'subject']);
    const idxProbUrl = findIndex(['문제 url', 'url', 'link']);
    const idxSolUrl = findIndex(['풀이 url', 'solution']);
    const idxCrit = findIndex(['criteria', 'standard', '기준']);

    window.problemsData = rows.slice(1).map((cols, i) => {
        if (cols.length < 2) return null;
        const getCol = (idx) => idx > -1 ? cols[idx] : "";

        // Generic Criteria Fallback
        const genericCriteria = `[AI 수리논술 표준 채점 기준]
1. 문제 이해 (20점)
- 제시문의 핵심 원리 파악 여부
- 문제에서 요구하는 조건들을 누락 없이 확인했는가

2. 논리적 서술 (40점)
- 도입-전개-결론의 구조적 완결성 (Start-to-End Logic)
- 수식 전개 과정의 비약 여부 (Since/Because 명시)
- 핵심 키워드 및 정리가 적절히 인용되었는가

3. 계산 및 결과 (30점)
- 수식 계산의 정확성
- 최종 답안의 단위 및 형태 오류 여부

4. 가독성 (10점)
- 글씨 및 수식의 정돈 상태`;

        let crit = getCol(idxCrit);
        if (!crit) crit = genericCriteria;

        return {
            id: getCol(idxId) || `Q${String(i + 1).padStart(3, '0')}`,
            university: getCol(idxUnivName) || 'Unknown',
            year: getCol(idxYearCol) || '2025',
            subject: "수리논술", // Hardcoded for sample
            question: getCol(idxProbType) || "논술 문제",
            criteria: crit,
            model_answer: "",
            problem_url: getCol(idxProbUrl),
            solution_url: getCol(idxSolUrl),
            raw: cols.join(',')
        };
    }).filter(p => p && p.university !== "Unknown");

    // Sort
    window.problemsData.sort((a, b) => a.university.localeCompare(b.university) || a.year.localeCompare(b.year));
    const countEl = document.getElementById('recordCount');
    if (countEl) countEl.innerText = `${window.problemsData.length} RECORDS`;
};

window.filterProblems = function () {
    const univ = document.getElementById('filterUniversity').value.toLowerCase();
    const year = document.getElementById('filterYear').value;
    let filtered = window.problemsData.filter(p => {
        const matchUniv = !univ || p.university.toLowerCase().includes(univ);
        const matchYear = !year || p.year.includes(year);
        return matchUniv && matchYear;
    });
    window.renderProblems(filtered);
};

window.renderProblems = function (items) {
    const list = document.getElementById('problemList');
    list.innerHTML = '';
    if (items.length === 0) {
        list.innerHTML = '<div class="text-gray-600 text-center py-10 text-sm">검색 결과가 없습니다.</div>';
        return;
    }
    items.forEach(p => {
        const div = document.createElement('div');
        div.className = "group bg-[#0a0a0c] border border-white/5 rounded-xl p-4 hover:border-blue-500/50 hover:bg-blue-500/5 transition cursor-pointer flex items-center justify-between";
        div.innerHTML = `
                    <div class="flex-1 truncate">
                         <div class="flex items-center gap-2 mb-1">
                              <span class="text-blue-500 text-[10px] font-bold px-2 py-0.5 bg-blue-500/10 rounded border border-blue-500/20">${p.year}</span>
                              <span class="text-gray-400 text-xs font-bold">${p.university}</span>
                         </div>
                         <div class="text-gray-300 text-sm truncate pr-4">${p.question.substring(0, 60)}...</div>
                    </div>
                    <div class="text-gray-600 group-hover:text-blue-500 transition">▶</div>
                 `;
        div.onclick = () => window.selectProblem(p);
        list.appendChild(div);
    });
};

window.selectProblem = function (p) {
    window.currentProblemId = p.id;
    document.getElementById('problemDetails').classList.remove('hidden');
    const setText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.innerText = text;
    };

    setText('detailTitle', p.question);
    setText('detailUnivMatch', `${p.university} ${p.year}`);

    // Update Asset Links
    const probLink = document.getElementById('problemLink');
    const solLink = document.getElementById('solutionLink');
    if (probLink) {
        probLink.href = p.problem_url || "#";
        probLink.innerHTML = p.problem_url ? `<span class="text-blue-400 hover:text-blue-300">🔗 문제 보기 (PDF)</span>` : `<span class="text-gray-600">문제 파일 없음</span>`;
        probLink.target = "_blank";
    }
    if (solLink) {
        solLink.href = p.solution_url || "#";
        solLink.innerHTML = p.solution_url ? `<span class="text-blue-400 hover:text-blue-300">🔗 해설 보기 (PDF)</span>` : `<span class="text-gray-600">해설 파일 없음</span>`;
        solLink.target = "_blank";
    }

    window.simulateContextSearch(p);
};

window.simulateContextSearch = async function (p) {
    const contextArea = document.getElementById('detailContext');
    contextArea.value = `Searching web for '${p.university} ${p.year} Grading Context'...`;
    contextArea.classList.add('animate-pulse', 'text-blue-400');
    await new Promise(resolve => setTimeout(resolve, 1500));
    contextArea.classList.remove('animate-pulse', 'text-blue-400');
    contextArea.value = p.criteria || "기본 채점 기준";
};

// Placeholder for API function (Module will override this)
window.submitAnswerToAPI = async function () {
    alert("AI 서버 연결 중입니다... 잠시만 기다려주세요. (Initializing...)");
};

window.startBatchAnalysis = function () {
    if (!window.currentProblemId) { alert("문제를 선택해주세요."); return; }
    if (!window.selectedFiles.length) { alert("답안을 업로드해주세요."); return; }
    window.submitAnswerToAPI(window.currentProblemId, window.selectedFiles[0]);
};

window.showReport = function (resultData) {
    const modal = document.getElementById('reportModal');
    modal.classList.remove('hidden');
    document.getElementById('reportStudentName').innerText = document.getElementById('studentName').value || "Unknown Student";

    // Simple render logic for now
    const score = resultData?.score || 0;
    document.getElementById('scoreValues').innerText = score;
    const feedback = resultData?.feedback?.text || resultData?.feedback || "결과 확인";
    document.getElementById('evalStrengths').innerText = feedback;
};

window.closeReport = function () {
    document.getElementById('reportModal').classList.add('hidden');
};
