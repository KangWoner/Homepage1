# Questio 배포 가이드

## 🚀 배포 방법

이 프로젝트는 **Firebase Hosting** 및 **Firebase Functions**를 사용합니다.

### 옵션 1: GitHub Actions 자동 배포 (권장)

#### 1단계: Firebase 서비스 계정 생성

1. [Firebase Console](https://console.firebase.google.com/) > **questio-2dd69** 프로젝트 선택
2. **프로젝트 설정** > **서비스 계정** 탭
3. **새 비공개 키 생성** 클릭하여 JSON 키 다운로드

#### 2단계: GitHub Secrets 설정

1. GitHub 저장소 > **Settings** > **Secrets and variables** > **Actions**
2. 다음 secrets 추가:

```
FIREBASE_SERVICE_ACCOUNT_QUESTIO_2DD69
```
- 값: 1단계에서 다운로드한 JSON 파일의 전체 내용

```
FIREBASE_TOKEN
```
- 생성 방법:
  ```bash
  firebase login:ci
  ```
- 생성된 토큰을 복사하여 추가

#### 3단계: 배포

```bash
git add .
git commit -m "Deploy to Firebase"
git push origin claude/check-features-Pjb5F
```

푸시하면 GitHub Actions가 자동으로 Firebase에 배포합니다.

---

### 옵션 2: 로컬에서 수동 배포

#### 사전 요구사항

- Node.js 20 이상
- Firebase CLI

#### 1단계: Firebase 로그인

```bash
firebase login
```

#### 2단계: 프로젝트 선택

```bash
firebase use questio-2dd69
```

#### 3단계: Functions 의존성 설치

```bash
cd functions
npm install
cd ..
```

#### 4단계: 배포

**전체 배포 (Hosting + Functions):**
```bash
firebase deploy
```

**Hosting만 배포:**
```bash
firebase deploy --only hosting
```

**Functions만 배포:**
```bash
firebase deploy --only functions
```

---

## 📍 배포된 URL

배포가 완료되면 다음 URL에서 접속 가능합니다:

- **메인 URL**: https://questio-2dd69.web.app
- **대체 URL**: https://questio-2dd69.firebaseapp.com

---

## 🔧 Functions 엔드포인트

배포된 Cloud Functions:

1. **submitAnswer** (채점 요청)
   - URL: `https://us-central1-questio-2dd69.cloudfunctions.net/submitAnswer`
   - Method: POST
   - Body: `{ problemId, studentName, imageUrl, criteria }`

2. **processGradingTask** (내부 워커)
   - Cloud Tasks Queue에서 자동 호출

3. **searchScoringCriteria** (채점 기준 검색)
   - URL: `https://us-central1-questio-2dd69.cloudfunctions.net/searchScoringCriteria`
   - Method: POST
   - Body: `{ university, year, problemType }`

---

## ⚙️ 필수 설정

### Firebase Functions 환경 변수

현재 `functions/index.js`에 하드코딩된 값들:

```javascript
const vertex_ai = new VertexAI({
  project: 'questio-2dd69',
  location: 'us-central1'
});
```

### Vertex AI API 활성화

Firebase Console에서 다음 API를 활성화해야 합니다:

1. **Vertex AI API**
2. **Cloud Tasks API**
3. **Cloud Functions API**
4. **Firestore API**

[Google Cloud Console](https://console.cloud.google.com/apis/dashboard?project=questio-2dd69)에서 확인

---

## 🧪 로컬 테스트

### Firebase Emulator로 테스트

```bash
firebase emulators:start
```

다음 URL에서 테스트:
- Hosting: http://localhost:5000
- Functions: http://localhost:5001
- Firestore: http://localhost:8080

---

## 📊 배포 상태 확인

```bash
# 현재 배포된 버전 확인
firebase hosting:channel:list

# Functions 로그 확인
firebase functions:log

# 배포 히스토리
firebase hosting:releases:list
```

---

## 🚨 문제 해결

### 1. Functions 배포 실패

**오류**: `PERMISSION_DENIED` 또는 `403`

**해결**:
```bash
# 프로젝트 확인
firebase projects:list
firebase use questio-2dd69

# 권한 확인
gcloud projects get-iam-policy questio-2dd69
```

### 2. Vertex AI 403 오류

**해결**:
1. [IAM 설정](https://console.cloud.google.com/iam-admin/iam?project=questio-2dd69) 확인
2. 서비스 계정에 **Vertex AI User** 역할 추가

### 3. Cloud Tasks Queue 없음

**해결**:
```bash
gcloud tasks queues create grading-queue \
  --location=us-central1 \
  --project=questio-2dd69
```

---

## 📝 배포 체크리스트

- [ ] Firebase 프로젝트 생성 완료 (**questio-2dd69**)
- [ ] Vertex AI API 활성화
- [ ] Cloud Tasks Queue 생성 (`grading-queue`)
- [ ] Firestore 데이터베이스 생성
- [ ] Functions 의존성 설치 (`cd functions && npm install`)
- [ ] `public/` 폴더에 `index.html`, `sampleProbs.csv` 존재
- [ ] GitHub Secrets 설정 (자동 배포 시)
- [ ] Firebase CLI 로그인 (수동 배포 시)

---

## 🎉 배포 완료 후

1. **메인 URL 접속**: https://questio-2dd69.web.app
2. **"지금 무료 체험 시작하기"** 버튼 클릭
3. **Admin Node 모달** 열림 확인
4. **CSV 업로드** 및 **문제 선택** 테스트
5. **답안 이미지 업로드** 후 **채점 실행** 테스트

---

**작성일**: 2026-01-10
**프로젝트**: Questio - AI 수리논술 첨삭 시스템
**Firebase Project ID**: questio-2dd69
