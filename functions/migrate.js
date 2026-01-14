const admin = require('firebase-admin');
const db = admin.firestore();

/**
 * 기존 grading_tickets 데이터를 students 컬렉션 구조로 마이그레이션합니다.
 */
async function migrateTicketsToStudentCollection() {
  console.log("🚀 마이그레이션을 시작합니다...");
  
  const ticketsSnapshot = await db.collection('grading_tickets').get();
  
  if (ticketsSnapshot.empty) {
    console.log("❌ 이동할 티켓 데이터가 없습니다.");
    return;
  }

  let migratedCount = 0;

  for (const doc of ticketsSnapshot.docs) {
    const ticketData = doc.data();
    
    // 1. studentId(Email) 확인 - 없을 경우 placeholder 처리
    // 기존 데이터에는 이메일이 없으므로 이름_migrated@temp.com 형태로 임시 생성합니다.
    const studentName = ticketData.studentName || "Anonymous";
    const studentEmail = ticketData.studentEmail || `${studentName.replace(/\s+/g, '_')}_migrated@placeholder.com`;
    const studentId = studentEmail; // 이메일을 고유 ID로 사용

    try {
      const studentRef = db.collection('students').doc(studentId);
      const submissionRef = studentRef.collection('submissions').doc(doc.id);

      // 2. 학생 기본 문서 생성 또는 업데이트
      await studentRef.set({
        name: studentName,
        email: studentEmail,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      // 3. 서브 컬렉션으로 데이터 복사
      await submissionRef.set({
        ticketId: doc.id,
        problemId: ticketData.problemId || "unknown",
        score: ticketData.result?.score || 0,
        coreCompetencies: ticketData.result?.coreCompetencies || {},
        feedback: ticketData.result?.feedback || "",
        createdAt: ticketData.createdAt || admin.firestore.FieldValue.serverTimestamp(),
        migrated: true // 마이그레이션된 데이터임을 표시
      });

      // 4. 원본 티켓에 studentId 기록 (추후 참조용)
      await doc.ref.update({
        studentId: studentId,
        studentEmail: studentEmail,
        isMigrated: true
      });

      migratedCount++;
      console.log(`✅ [${migratedCount}] 티켓 ${doc.id} -> 학생 ${studentId} 이동 완료`);
      
    } catch (error) {
      console.error(`❌ 티켓 ${doc.id} 처리 중 오류 발생:`, error);
    }
  }

  console.log(`\n✨ 마이그레이션 종료: 총 ${migratedCount}개의 데이터가 처리되었습니다.`);
}

// 실행
// migrateTicketsToStudentCollection();