# Growth Index 테스트 가이드

## 🎯 테스트 목표
실제 학생 데이터를 기반으로 성장 지수가 제대로 계산되는지 검증

## 📝 테스트 시나리오

### 1단계: 첫 제출 (Baseline)
```
학생: test-student@example.com
이름: 테스트 학생
문제: Q001 (아무 문제)
답안: 이미지 업로드

✅ 예상 결과:
- 제출 완료
- Growth Analysis: "첫 제출입니다" 메시지
- growthMetrics.isFirstSubmission: true
- growthMetrics.trend: 'new'
```

### 2단계: 두 번째 제출 (점수 향상)
```
학생: 동일 (test-student@example.com)
문제: Q002 (다른 문제)
답안: 더 나은 풀이 업로드

✅ 예상 결과:
- 과거 이력 조회 성공
- Growth Analysis에 실제 점수 비교 표시
  예: "이전 제출 점수: 75점 → 현재: 88점 (+13점 향상)"
- growthMetrics.scoreImprovement: 양수 (예: +13)
- growthMetrics.trend: 'improving'
- competencyGrowth에 각 역량별 증감 표시
```

### 3단계: 세 번째 제출 (점수 하락)
```
학생: 동일
문제: Q003
답안: 실수가 많은 풀이

✅ 예상 결과:
- 과거 2개 이력 조회
- Growth Analysis: "점수가 하락했습니다" 경고
- growthMetrics.scoreImprovement: 음수
- growthMetrics.trend: 'declining'
- AI가 "반복되는 실수" 지적
```

### 4단계: 다른 학생 테스트
```
학생: student2@example.com
이름: 학생2

✅ 예상 결과:
- 완전히 새로운 학생으로 인식
- 첫 제출로 처리
- student1과 데이터 분리됨
```

## 🔍 검증 포인트

### Firestore 데이터 확인
```
Firebase Console → Firestore Database

1. students/{studentEmail}/
   - name: "테스트 학생"
   - email: "test-student@example.com"
   - totalSubmissions: 3
   - lastSubmissionAt: (최근 시간)

2. students/{studentEmail}/submissions/
   - 3개 문서 존재
   - 각각 score, coreCompetencies, createdAt 포함

3. grading_tickets/{ticketId}/
   - studentId: "test-student@example.com"
   - result.growthMetrics 존재
   - result.growthMetrics.trend: 'improving' | 'declining' | 'stable'
```

### 프론트엔드 리포트 확인
```
리포트 모달에서:
1. ✅ Growth Metrics 섹션 표시
   - 트렌드 아이콘 (🟢/🔴/⚪)
   - 점수 개선도 (+X점 또는 -X점)
   - 제출 횟수

2. ✅ Growth Analysis 섹션
   - 실제 과거 점수 언급
   - 구체적인 개선/악화 분석
   - "시뮬레이션" 같은 가짜 표현 없음

3. ✅ Core Competencies 섹션
   - 문제해결력, 논리적 서술, 계산 정확도
   - 각각 0-100 점수
   - 과거 대비 증감 표시 (있다면)
```

## 🐛 문제 해결

### 에러: "studentId is undefined"
- 원인: 프론트엔드에서 studentEmail 전송 안 됨
- 해결: studentEmail input에 값 입력 확인

### 에러: "Missing or insufficient permissions"
- 원인: Firestore 보안 규칙
- 해결: Firestore Rules에 students 컬렉션 쓰기 권한 추가
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /students/{studentId} {
      allow read, write: if true;  // 테스트용 (운영에선 수정 필요)
    }
    match /students/{studentId}/submissions/{submissionId} {
      allow read, write: if true;
    }
    match /grading_tickets/{ticketId} {
      allow read, write: if true;
    }
  }
}
```

### 에러: "Index required"
- 원인: Firestore에 복합 인덱스 없음
- 해결: 에러 메시지의 링크 클릭하여 자동 생성
- 또는 수동 생성:
  - Collection: students/{studentId}/submissions
  - Fields: createdAt (Descending)

## 📊 성공 기준

- [ ] 동일 학생의 여러 제출이 올바르게 연결됨
- [ ] 과거 점수가 AI 프롬프트에 전달됨
- [ ] Growth Analysis가 실제 데이터 기반으로 생성됨
- [ ] growthMetrics가 정확히 계산됨
- [ ] 다른 학생 데이터가 섞이지 않음
- [ ] Firestore에 submissions 히스토리 저장됨

## 🎉 예상 출력 예시

**첫 제출:**
```
Growth Analysis:
"이번이 첫 제출입니다. 문제 이해도는 양호하나 증명 과정의 엄밀성이 부족합니다."
```

**두 번째 제출 (개선):**
```
Growth Analysis:
"이전 제출(75점) 대비 13점 향상되었습니다. 특히 논리적 서술력이 68점 → 82점으로 크게 개선되었습니다.
하지만 여전히 계산 실수(부호 오류)가 반복되고 있어 주의가 필요합니다."
```

**세 번째 제출 (하락):**
```
Growth Analysis:
"이전 88점에서 72점으로 하락했습니다. 반복되는 문제점:
1. 변수 정의 누락 (3회 연속)
2. 중간 단계 생략
개선이 필요합니다."
```
