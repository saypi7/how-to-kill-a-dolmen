# How to Kill a Dolmen

React + TypeScript + Vite 화면과 Go WebSocket 서버로 실행하는 2인 대전 게임입니다. 방 생성 → 코드로 입장 → 두 명 준비 → 30초 수집 → 90초 자동 전투 → 결과 순서로 진행합니다. 서버가 등장, 수집 유효성, 소환 수량, 이동, 공격, 고인돌 체력, 승패를 계산합니다.

## VS Code에서 실행

준비: Node.js 22.12 이상, Go 1.23 이상, VS Code. `dino-battle.code-workspace`를 열거나 이 폴더를 VS Code에서 여세요.

최초 한 번, 프로젝트 루트 터미널:

```powershell
npm install
cd backend
go mod download
```

터미널 1 — 프로젝트 루트:

```powershell
npm run dev
```

터미널 2 — 프로젝트 루트:

```powershell
cd backend
go run .
```

브라우저에서 <http://localhost:5173>를 여세요. VS Code의 **터미널 → 작업 실행 → 개발 서버 둘 다 시작**으로도 두 서버를 시작할 수 있습니다. 최초에는 **의존성 설치** 작업을 실행하세요. 종료는 두 터미널에서 각각 `Ctrl+C`입니다.

개발 화면은 5173, Go 서버는 8080을 사용합니다. Vite가 `/ws`와 `/healthz`를 Go 서버로 전달합니다. 다른 PC에서 접속할 때는 같은 네트워크의 서버 PC 주소를 사용하고 해당 화면 주소를 Go 서버의 `ALLOWED_ORIGINS`에 추가하세요.

타입 검사: `npm run typecheck`. 프로덕션 빌드: `npm run build` (타입 검사 포함).

## 한 판 테스트

1. 브라우저 창 A에서 이름을 입력하고 **새 방 만들기**를 누릅니다.
2. 다른 창 B에서 다른 이름과 방 코드를 입력해 입장합니다. 3번째 플레이어 입장은 거부되어야 합니다.
3. 양쪽에서 **준비 완료**를 누릅니다. 30초 동안 각자 수풀 위에 잠깐 나타나는 공룡을 클릭합니다.
4. 수집 종료 후 자동 전투 화면으로 전환되는지 확인합니다.
5. 하단 보관함을 클릭해 소환합니다. 수량이 하나씩 줄고, 공룡들이 이동하다 상대 공룡이나 고인돌을 공격해야 합니다.
6. 양쪽 고인돌 체력이 두 창에서 같고, 파괴 또는 90초 종료 시 결과가 대응되는지 확인합니다.
7. 결과에서 **처음으로 돌아가기**를 누르고 다시 방을 만들거나 입장합니다.

별도 창이나 시크릿 창을 사용하면 두 플레이어 세션을 분리하기 쉽습니다. 새로고침, 잠깐의 연결 끊김, 수집 연속 클릭, 수량 0인 공룡 클릭도 확인하세요.

## 빌드와 서버 테스트

프로젝트 루트에서:

```powershell
npm run build
npm run test:server
```

Go 경쟁 상태 검사도 지원합니다. 로컬 Go 환경에 C 컴파일러가 필요할 수 있습니다.

```powershell
npm run test:race
```

배포 형태를 로컬에서 확인하려면 루트에서 `npm run build` 후 `backend` 폴더에서 `go run .`을 실행하고 <http://localhost:8080>에 접속하세요. Go가 `dist` 화면과 WebSocket을 함께 제공합니다. `npm run preview`는 Vite 빌드 화면 확인용입니다.

## 파일과 수정 위치

| 파일/폴더 | 역할 |
| --- | --- |
| `src/` | React 화면, 수집 입력, 전투 표시, 스타일 |
| `backend/` | 방 관리, WebSocket, 서버 게임 판정, 테스트 |
| `public/game-data.json` | 공룡 30종 이름·이미지·등장 가중치·능력치, 시간과 전장 설정 |
| `public/assets/` | 사용자가 제공한 배경·고인돌·공룡 이미지 |
| `Dockerfile`, `render.yaml` | Render에서 화면+서버를 함께 실행하는 구성 |
| `.vscode/` | VS Code 실행·빌드·테스트 작업 |
| `supabase/schema.sql` | 선택 사항인 경기 결과 저장 테이블 |

밸런스 수정 후 Go 서버를 재시작하세요. 클라이언트에서 보관 수량이나 체력을 보내도 서버 상태를 덮어쓰지 않습니다. 배경은 제공받은 이미지 하나를 재사용합니다. 타이틀은 사용자 선화를 채색한 투명 `public/title.png`입니다. 원본 GIF는 `public/assets/title-original.gif`에 보존했습니다. 이미지 교체 시 배포 화면은 다시 빌드하세요. 역할·연출·버그 수정은 `UPDATE-NOTES.md`에 정리했습니다.

## 환경 변수

Go 서버는 `.env` 파일을 자동으로 읽지 않습니다. PowerShell에서 설정하고 실행하거나 Render의 Environment에 등록하세요.

```powershell
$env:PORT="8080"
$env:ALLOWED_ORIGINS="http://localhost:5173,http://192.168.0.10:5173"
cd backend
go run .
```

| 변수 | 기본값 / 용도 |
| --- | --- |
| `PORT` | `8080`; 모든 인터페이스에서 HTTP/WebSocket 수신 |
| `GAME_DATA_PATH` | `../public/game-data.json`; 서버가 읽을 게임 데이터 |
| `FRONTEND_DIR` | `../dist`; Go가 제공할 빌드 화면 경로 |
| `ALLOWED_ORIGINS` | 허용할 화면 origin을 쉼표로 구분. 미설정 시 `http://localhost:5173`, `http://127.0.0.1:5173` 허용. 동일 호스트 origin은 항상 허용 |
| `VITE_SERVER_URL` | 프런트를 별도로 배포할 때 WebSocket 전체 URL. 기본값은 현재 origin의 `/ws` |
| `SUPABASE_URL` | 선택 사항; 경기 결과를 기록할 Supabase 프로젝트 주소 |
| `SUPABASE_SERVICE_ROLE_KEY` | 선택 사항; Go 서버에서만 사용하는 Supabase 키 |

프런트 환경 변수는 루트 `.env.local`에 넣고 Vite를 재시작하거나 다시 빌드하세요. Supabase 키는 `VITE_` 변수에 넣지 마세요.

## Render 배포

이 폴더 내용이 Git 저장소 최상위에 오도록 올린 뒤 Render에서 **New → Blueprint**로 저장소를 연결하면 `render.yaml`을 사용할 수 있습니다. 이 대화에서 계정 연결이나 실제 배포는 수행하지 않았습니다.

한 Docker Web Service가 화면과 `/ws`를 함께 제공합니다. Docker 빌드는 Node로 React를 빌드하고 Go 바이너리를 만든 뒤 실행합니다. `/healthz`가 상태 확인 주소이며 서비스는 `PORT=10000`을 사용합니다. 별도 프런트 주소를 쓰는 경우 서버에 정확한 `ALLOWED_ORIGINS`를 설정하고 프런트의 `VITE_SERVER_URL`을 `wss://서버주소/ws`로 빌드하세요. [Render Docker 안내](https://render.com/docs/docker), [WebSocket 안내](https://render.com/docs/websocket), [Blueprint 형식](https://render.com/docs/blueprint-spec).

방과 진행 중인 경기는 서버 메모리에 있으므로 **인스턴스를 1개로 유지**하세요. 재시작·재배포 시 진행 중인 방은 초기화됩니다. 여러 서버에 방을 공유하는 기능은 포함하지 않았습니다.

Docker가 설치되어 있으면 다음으로 동일 구성을 확인할 수 있습니다.

```powershell
docker build -t dino-battle .
docker run --rm -p 8080:10000 dino-battle
```

## Supabase 결과 저장 (선택)

게임 실행에는 Supabase가 필요하지 않습니다. 결과를 저장하려면 Supabase SQL Editor에서 `supabase/schema.sql`을 실행하고 Go 서버에 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`를 설정하세요. 서버가 종료된 경기만 `game_results`에 기록합니다. 실시간 게임 상태는 Go가 관리합니다. 결과 저장이 실패해도 경기 결과는 화면에 표시됩니다.

로그인, 전적 조회 화면, 랭킹, 영구 공룡 보관함은 포함하지 않았습니다. Supabase 실계정 저장과 Render 실서비스 접속은 배포 환경에서 추가 확인해야 합니다.

