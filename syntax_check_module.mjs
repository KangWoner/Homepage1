
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-app.js";
import { getFirestore, doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyB0bOxRGkg2DDbz5dTX-Mv2DE1vLbvGC7k",
    authDomain: "questio-2dd69.firebaseapp.com",
    projectId: "questio-2dd69",
    storageBucket: "questio-2dd69.firebasestorage.app",
    messagingSenderId: "738461414990",
    appId: "1:738461414990:web:baa3d65c8469be6c90351f",
    measurementId: "G-TPRBFKQGG6"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

window.submitAnswerToAPI = async function (problemId, file) {
    document.getElementById('progressOverlay').classList.remove('hidden');
    const setProgress = (n, id) => {
        document.getElementById('progressBar').style.width = n + '%';
        document.getElementById('progressPercent').innerText = n + '%';
        if (id) {
            const el = document.getElementById(id);
            if (el) {
                el.className = 'flex items-center gap-4 text-blue-400 animate-pulse';
                el.children[0].className = 'w-4 h-4 rounded border border-blue-500 bg-blue-500 text-white flex items-center justify-center text-[10px]';
            }
        }
    };
    setProgress(5, null);
    document.getElementById('resultArea').classList.add('hidden');

    // Reset task indicators
    ['taskFormula', 'taskLogic', 'taskFeedback'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.className = 'flex items-center gap-4 text-gray-600';
            el.children[0].className = 'w-4 h-4 rounded border border-current flex items-center justify-center text-[10px]';
        }
    });

    try {
        const toBase64 = file => new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result);
            reader.onerror = error => reject(error);
        });

        const imageBase64 = await toBase64(file);
        const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        const API_URL = isLocal ? 'https://submitanswer-qm5h7q6meq-uc.a.run.app' : '/submitAnswer';

        const studentName = document.getElementById('studentName').value || "Guest Student";
        const criteriaText = document.getElementById('detailContext').value;

        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: studentName, imageUrl: imageBase64, problemId: problemId, criteria: criteriaText })
        });

        if (!response.ok) throw new Error('Network error');
        const data = await response.json();
        const ticketId = data.ticketId;

        const unsub = onSnapshot(doc(db, "grading_tickets", ticketId), (docSnap) => {
            const d = docSnap.data();
            if (!d) return;

            let completedCount = 0;
            ['formula', 'logic', 'feedback'].forEach((task) => {
                const taskId = 'task' + task.charAt(0).toUpperCase() + task.slice(1);
                if (d.tasks && d.tasks[task]) {
                    const status = d.tasks[task].status;
                    if (status === 'processing') {
                        // setProgress update handled by general progress bar, but we can highlight current task
                        const el = document.getElementById(taskId);
                        if (el && el.className.includes('text-gray-600')) {
                            el.className = 'flex items-center gap-4 text-blue-400 animate-pulse';
                            el.children[0].className = 'w-4 h-4 rounded border border-blue-500 bg-blue-500 text-white flex items-center justify-center text-[10px]';
                        }
                    } else if (status === 'completed') {
                        completedCount++;
                        const el = document.getElementById(taskId);
                        if (el) {
                            el.className = 'flex items-center gap-4 text-green-400';
                            el.children[0].className = 'w-4 h-4 rounded border border-green-500 bg-green-500 text-white flex items-center justify-center text-[10px]';
                        }
                    }
                }
            });

            const pct = 10 + (completedCount * 30);
            document.getElementById('progressBar').style.width = pct + '%';
            document.getElementById('progressPercent').innerText = pct + '%';

            if (d.status === 'completed') {
                document.getElementById('progressOverlay').classList.add('hidden');
                if (window.showReport) window.showReport(d.result);
                unsub();
            }
        });

    } catch (error) {
        console.error("Analysis Error:", error);
        alert("분석 요청 중 오류가 발생했습니다: " + error.message);
        document.getElementById('progressOverlay').classList.add('hidden');
    }
};
