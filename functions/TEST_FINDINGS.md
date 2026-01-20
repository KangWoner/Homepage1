# 테스트 실험 결과 및 문제점 분석 보고서

## 📊 테스트 실행 결과

### 전체 테스트 현황
```
✅ 테스트 스위트: 3개 통과
✅ 테스트 케이스: 36개 통과
⏱️  실행 시간: 3.6초
📈 코드 커버리지: 34.64%
```

### 테스트 파일별 상세

| 파일 | 테스트 수 | 상태 | 설명 |
|------|-----------|------|------|
| `callGemini.test.js` | 22 | ✅ PASS | 독립 함수 단위 테스트 (mock) |
| `callGemini.integration.test.js` | 5 | ✅ PASS | 실제 index.js 통합 테스트 |
| `csvParsing.test.js` | 9 | ✅ PASS | CSV 파싱 및 problemsMap 테스트 |

### 코드 커버리지 상세
```
File      | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
----------|---------|----------|---------|---------|-------------------------
index.js  |   34.64 |   25.00  |  33.33  |  34.64  | 102-171,189-417,426-469
```

**커버된 부분:**
- ✅ CSV 파싱 로직 (14-46)
- ✅ callGemini 헬퍼 함수 (48-97)
- ✅ 모듈 exports

**커버되지 않은 부분:**
- ❌ submitAnswer API (102-171) - **0% 커버리지**
- ❌ processGradingTask 워커 (189-417) - **0% 커버리지**
- ❌ searchScoringCriteria API (426-469) - **0% 커버리지**

---

## 🐛 발견된 버그 및 문제점

### 🔴 Critical: CSV ID 할당 버그

**위치**: `index.js:21-42`

**문제**:
```javascript
rows.forEach((row, index) => {
    const cols = row.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
    const id = `Q${String(index + 1).padStart(3, '0')}`;  // ⚠️ 문제!

    if (cols.length >= 3) {
        problemsMap.set(id, { ... });
    }
});
```

**버그 동작**:
- 컬럼이 부족한 행을 건너뛰어도 ID는 계속 증가
- 예: 3개 행이 있고 2번째 행이 잘못된 경우
  - 결과: Q001, Q003만 생성 (Q002는 누락)
  - 예상: Q001, Q002 생성

**재현 방법**:
```csv
University,Year,Question Type,Prob URL,Sol URL
서울대,2024,미적분학,http://prob1.com,http://sol1.com
연세대,2023                          <- 컬럼 부족
고려대,2022,확률론,http://prob3.com,http://sol3.com
```

**결과**: `problemsMap` = { Q001: {...}, Q003: {...} }

**영향도**:
- 🔴 **High** - ID 불연속성으로 프론트엔드에서 문제 참조 시 혼란
- 프로덕션에서 CSV 수정 시 예측 불가능한 ID 변경

**해결 방안**:
```javascript
let validIndex = 0;
rows.forEach((row) => {
    const cols = row.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);

    if (cols.length >= 3) {
        validIndex++;
        const id = `Q${String(validIndex).padStart(3, '0')}`;
        problemsMap.set(id, { ... });
    }
});
```

---

### 🟡 Medium: Console.error 노이즈

**문제**:
테스트 실행 시 에러 핸들링 테스트에서 `console.error` 출력이 많이 발생:

```
console.error
  Gemini Error: SyntaxError: Unexpected token 'j'
  Gemini Error: Error: API quota exceeded
  Gemini Error: Error: Network timeout
  ...
```

**영향도**:
- 🟡 **Medium** - 실제 에러와 테스트 에러 구분 어려움
- 테스트 출력이 지저분함

**해결 방안**:
```javascript
// 테스트에서 console.error를 일시적으로 supppress
beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  console.error.mockRestore();
});
```

---

### 🟡 Medium: 실제 코드 커버리지 vs 테스트 커버리지 불일치

**문제 1: 독립 함수 복사본 테스트**

`callGemini.test.js`는 함수를 복사해서 테스트하므로 실제 `index.js` 커버리지에 기여하지 않음:

```javascript
// callGemini.test.js
callGemini = async function(...) {  // ⚠️ 복사본!
    // ... 함수 전체 복사
};
```

**해결**: `callGemini.integration.test.js` 방식 사용 (실제 함수 import)

**문제 2: 초기 커버리지 0%**

처음에는 `index.js`에서 아무것도 export하지 않아 테스트 불가능:

**해결됨**:
```javascript
// index.js 마지막에 추가
module.exports = {
    submitAnswer: exports.submitAnswer,
    processGradingTask: exports.processGradingTask,
    searchScoringCriteria: exports.searchScoringCriteria,
    callGemini,
    problemsMap
};
```

---

### 🟢 Low: CSV 파싱 정규식 복잡도

**위치**: `index.js:22`

```javascript
const cols = row.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
```

**문제**:
- 정규식이 매우 복잡하여 유지보수 어려움
- 엣지 케이스에서 예상치 못한 동작 가능

**테스트 결과**:
- ✅ 일반 CSV 파싱
- ✅ 쿼테이션 내부 쉼표 처리
- ✅ 빈 필드 처리
- ✅ UTF-8 한글 처리
- ✅ CRLF 줄바꿈 처리

**권장**: CSV 전문 라이브러리 사용 (예: `csv-parse`, `papaparse`)

---

## ⚠️ 테스트의 한계점

### 1. **Mock에 의존한 단위 테스트**

**현재 상황**:
- VertexAI API 완전 mock 처리
- Firebase Admin 완전 mock 처리
- 실제 API 호출 없음

**한계**:
- 실제 Gemini API 응답 형식 변경 시 감지 불가
- Firebase Functions 런타임 환경 이슈 감지 불가
- 실제 프로덕션 에러 재현 불가

**개선 방안**:
1. **통합 테스트** (Firebase Emulator 사용)
2. **E2E 테스트** (실제 API 호출, 별도 환경)

---

### 2. **핵심 비즈니스 로직 미테스트**

**미커버 함수들**:

#### `submitAnswer` (102-171) - 0% 커버리지
- Cloud Tasks 디스패치 로직
- Firestore 티켓 생성
- CORS 처리
- 에러 핸들링

**필요 테스트**: 15개 이상

#### `processGradingTask` (189-417) - 0% 커버리지
- 3가지 태스크 타입 처리 (formula, logic, feedback)
- 점수 계산 로직
- 잘못된 문제 감지
- AI API 에러 처리
- HTML 레포트 생성
- Firestore 업데이트

**필요 테스트**: 30개 이상

#### `searchScoringCriteria` (426-469) - 0% 커버리지
- Google Search Grounding
- CORS 처리
- 에러 핸들링

**필요 테스트**: 8개 이상

---

### 3. **엣지 케이스 및 에러 시나리오 부족**

**현재 부족한 테스트**:

#### 점수 계산 로직
```javascript
// Line 344-348
let finalScore = Math.max(0, 100 - logicDeduction - formulaDeduction);

if (isWrongProblem) {
    finalScore = 0;
}
```

**필요 시나리오**:
- [ ] logicDeduction = undefined
- [ ] formulaDeduction = NaN
- [ ] 음수 점수 처리
- [ ] 100점 초과 처리
- [ ] 소수점 점수

#### 이미지 파싱
```javascript
// Line 217-221
if (imageUrl && imageUrl.startsWith('data:')) {
    const matches = imageUrl.match(/^data:(.+);base64,(.+)$/);
    if (matches) {
        imagePart = { mimeType: matches[1], data: matches[2] };
    }
}
```

**필요 시나리오**:
- [ ] 잘못된 base64 인코딩
- [ ] 지원되지 않는 MIME 타입
- [ ] 매우 큰 이미지 (메모리 문제)
- [ ] 빈 이미지 데이터

---

## 🎯 개선 제안

### 즉시 조치 (High Priority)

1. **CSV ID 버그 수정**
   ```javascript
   // index.js:21-42 수정 필요
   ```

2. **console.error 노이즈 제거**
   ```javascript
   // 모든 테스트 파일에 beforeEach/afterEach 추가
   ```

3. **submitAnswer 테스트 작성**
   - 15개 테스트 케이스
   - Firebase Functions 엔드포인트 mocking

### 단기 조치 (Medium Priority)

4. **processGradingTask 테스트 작성**
   - 30개 이상 테스트 케이스
   - 점수 계산 로직 상세 테스트

5. **통합 테스트 환경 구축**
   ```bash
   npm install --save-dev @firebase/rules-unit-testing
   ```
   - Firebase Emulator Suite 사용
   - 실제 Firestore, Cloud Tasks 시뮬레이션

### 장기 조치 (Low Priority)

6. **CSV 파싱 라이브러리 교체**
   ```bash
   npm install csv-parse
   ```

7. **E2E 테스트 구축**
   - 실제 Gemini API 호출 (별도 프로젝트)
   - 프로덕션 환경 시뮬레이션

8. **CI/CD 파이프라인**
   ```yaml
   # .github/workflows/test.yml
   - name: Run tests
     run: npm test
   - name: Check coverage
     run: npm run test:coverage
   - name: Fail if coverage < 80%
   ```

---

## 📈 커버리지 로드맵

| 시점 | 목표 | 주요 작업 | 현재 상태 |
|------|------|-----------|-----------|
| **현재** | 35% | callGemini + CSV 파싱 | ✅ 완료 |
| **1일 후** | 50% | submitAnswer 테스트 | ⏳ 대기 |
| **3일 후** | 70% | processGradingTask 테스트 | ⏳ 대기 |
| **1주 후** | 80% | searchScoringCriteria + 통합 테스트 | ⏳ 대기 |
| **2주 후** | 90% | E2E + 엣지 케이스 | ⏳ 대기 |

---

## 🔍 실험 중 발견한 인사이트

### 1. **모듈 캐싱 이슈**

CSV 테스트 중 `problemsMap`이 이전 테스트의 값을 유지하는 문제 발견:

**해결**:
```javascript
beforeEach(() => {
    jest.resetModules(); // 모듈 캐시 초기화
});
```

### 2. **Firebase Functions Export 패턴**

Cloud Functions는 특별한 export 패턴 필요:

```javascript
// ❌ 안됨
module.exports = { submitAnswer };

// ✅ 됨
exports.submitAnswer = onRequest(...);
module.exports.submitAnswer = exports.submitAnswer;
```

### 3. **Mock 순서의 중요성**

Mock은 `require()` 전에 호출되어야 함:

```javascript
// ✅ 올바른 순서
jest.mock('@google-cloud/vertexai');
const { callGemini } = require('./index.js');

// ❌ 잘못된 순서
const { callGemini } = require('./index.js');
jest.mock('@google-cloud/vertexai'); // Too late!
```

---

## 📝 최종 평가

### 긍정적 측면
✅ **테스트 인프라 구축 완료**
✅ **핵심 헬퍼 함수 검증**
✅ **실제 버그 1개 발견** (CSV ID 할당)
✅ **커버리지 0% → 34.64% 달성**
✅ **36개 테스트 케이스 통과**

### 개선 필요 측면
⚠️ **핵심 비즈니스 로직 65% 미테스트**
⚠️ **통합/E2E 테스트 부재**
⚠️ **점수 계산 로직 검증 부족**
⚠️ **에러 시나리오 커버리지 낮음**

### 권장사항
1. **즉시**: CSV ID 버그 수정
2. **이번 주**: submitAnswer, processGradingTask 테스트
3. **다음 주**: Firebase Emulator 통합 테스트
4. **지속적**: CI/CD 파이프라인 구축

---

## 🚀 다음 단계

1. **CSV ID 버그 수정 PR 생성**
2. **submitAnswer 테스트 작성 시작**
3. **점수 계산 로직 상세 테스트**
4. **Firebase Emulator 환경 구축**

**예상 작업 시간**:
- 버그 수정: 30분
- submitAnswer 테스트: 2-3시간
- processGradingTask 테스트: 4-5시간
- 통합 테스트: 3-4시간

**총 예상**: 약 10-13시간
