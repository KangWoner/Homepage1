# 테스트 계획 (Test Plan)

## ✅ 완료된 테스트

### callGemini 함수 (22 tests)
- [x] JSON 파싱 (application/json, markdown, plain)
- [x] 텍스트 응답 처리
- [x] 이미지 데이터 처리
- [x] 설정 병합
- [x] 에러 핸들링
- [x] 엣지 케이스

## 🔴 우선순위 높음 - 즉시 필요

### 1. CSV 파싱 로직 테스트 (csvParser.test.js)
**파일**: index.js:14-46

**테스트 케이스**:
- [ ] 정상적인 CSV 파싱
- [ ] 쉼표가 포함된 필드 (쿼테이션 처리)
- [ ] 빈 필드 처리
- [ ] 3개 미만 컬럼 처리
- [ ] UTF-8 인코딩 처리
- [ ] 파일 없을 때 에러 처리
- [ ] problemsMap에 올바르게 저장되는지

**위험도**: 🔴 높음 - CSV 로딩 실패 시 전체 시스템 마비

### 2. submitAnswer API 테스트 (submitAnswer.test.js)
**파일**: index.js:100-177

**테스트 케이스**:
- [ ] 정상 요청 처리
- [ ] imageUrl 없을 때 400 에러
- [ ] CORS OPTIONS 요청 처리
- [ ] Firestore 티켓 생성 확인
- [ ] Cloud Tasks 3개 디스패치 확인
- [ ] 에러 시 500 응답
- [ ] ticketId 응답 검증

**위험도**: 🔴 높음 - 메인 API 엔드포인트

### 3. processGradingTask 테스트 (processGradingTask.test.js)
**파일**: index.js:180-422 (가장 복잡한 함수)

**테스트 케이스**:
- [ ] formula 태스크 처리
- [ ] logic 태스크 처리
- [ ] feedback 태스크 처리
- [ ] 점수 계산 로직 (다양한 시나리오)
  - [ ] 100점 (완벽)
  - [ ] 부분 점수 (80점, 60점, 등)
  - [ ] 0점 (잘못된 문제 풀이)
  - [ ] 0점 (AI API 에러)
- [ ] 잘못된 문제 풀이 감지 (is_correct_problem: false)
- [ ] AI 에러 시 fallback 로직
- [ ] HTML 레포트 생성
- [ ] Firestore 업데이트 검증
- [ ] 3개 태스크 완료 후 최종 상태 변경

**위험도**: 🔴 매우 높음 - 핵심 비즈니스 로직

## 🟡 우선순위 중간 - 빠른 시일 내 필요

### 4. searchScoringCriteria 테스트
**파일**: index.js:424-471

**테스트 케이스**:
- [ ] 정상 검색 요청
- [ ] CORS 처리
- [ ] Google Search Grounding 통합
- [ ] 에러 처리

### 5. 이미지 파싱 유틸리티 테스트
**파일**: index.js:217-221

**테스트 케이스**:
- [ ] 정상 base64 data URL
- [ ] 잘못된 형식
- [ ] 지원되지 않는 MIME 타입
- [ ] 빈 이미지 데이터

## 🔵 우선순위 낮음 - 추후 개선

### 6. 통합 테스트 (integration.test.js)
- [ ] Firebase Emulator에서 전체 플로우 테스트
- [ ] submitAnswer → processGradingTask → 최종 결과 확인
- [ ] 실제 Firestore 읽기/쓰기

### 7. E2E 테스트
- [ ] 프론트엔드 → 백엔드 전체 플로우
- [ ] 실제 이미지 업로드 및 채점

## 📊 현재 테스트 커버리지

```
함수별 커버리지:
✅ callGemini: 100% (22 tests)
❌ CSV 파싱: 0%
❌ submitAnswer: 0%
❌ processGradingTask: 0%
❌ searchScoringCriteria: 0%

전체 커버리지: 약 20% 추정
```

## 🎯 목표

- **단기 (1주)**: 우선순위 높음 항목 완료 → 60% 커버리지
- **중기 (2주)**: 우선순위 중간 항목 완료 → 80% 커버리지
- **장기 (1개월)**: 통합/E2E 테스트 → 90%+ 커버리지

## 🚀 실행 방법

```bash
# 단위 테스트
npm test

# 특정 파일 테스트
npm test callGemini.test.js

# 커버리지 리포트
npm run test:coverage

# 감시 모드 (개발 중)
npm run test:watch
```

## 📝 참고사항

1. **Mock 우선**: 외부 API (Vertex AI, Firestore)는 기본적으로 mock 처리
2. **실제 API 테스트**: `*.integration.test.js` 파일에 분리
3. **Firebase Emulator**: 통합 테스트 시 사용
4. **CI/CD**: GitHub Actions에서 자동 실행 설정 필요
