# 예지(YE-G) 공식 홈페이지

기존 HTML·CSS·Vanilla JavaScript 진단 도구를 유지한 공식 홈페이지 1차 로컬 구현입니다. 프레임워크와 런타임 패키지를 추가하지 않았습니다. 운영 주소와 Vercel 프로젝트는 변경하지 않았으며 원격 Push·배포를 수행하지 않았습니다.

## 로컬 실행

Node.js 24 환경에서 프로젝트 디렉터리 안에서 실행합니다. 패키지 설치는 필요 없습니다.

```sh
node tools/preview.mjs --mock-api
```

- 홈페이지: http://127.0.0.1:4173/
- 진단 도구: http://127.0.0.1:4173/diagnosis
- `--mock-api`는 AI·공공데이터의 명시적 모의 응답을 제공합니다. 외부 호출이나 과금은 없습니다.
- 옵션 없이 실행하면 API는 503으로 차단됩니다. 이 서버는 로컬 검증 전용이며 운영용이 아닙니다.
- 진단 정보는 기존과 같이 현재 탭의 메모리에만 존재하며 새로고침 시 초기화됩니다.
- 서버를 종료하려면 실행 중인 터미널에서 Ctrl+C를 누릅니다.

## 검증

```sh
node tests/regression.mjs
node tests/player.mjs
node tests/api-contracts.mjs
# 위의 모의 서버를 실행한 상태에서:
node tests/http.mjs
```

실제 API 파일의 모의 외부 응답 테스트와 로컬 미리보기의 모의 API는 별개입니다. Vercel 런타임·운영 키·실제 외부 서비스 동작을 검증했다고 간주하지 않습니다.

## 구성

| 위치 | 역할 |
| --- | --- |
| `index.html`, `styles/site.css`, `scripts/site.mjs` | 공식 메인·서비스·브랜드·로컬 소개 |
| `diagnosis.html`, `styles/diagnosis-shell.css` | 기존 5단계 진단 및 최소 화면 보완 |
| `api/diagnose.js`, `api/market-data.js` | 기준본과 동일한 기존 서버 API |
| `scripts/character-media.mjs` | 최신 영상 순서·포스터 목록 |
| `scripts/character-player.mjs` | 순차 재생·정지·실패 대체 처리 |
| `assets/brand/` | 웹용 H.264 4종·원본 추출 포스터·변환 기록 |
| `vercel.json` | `/diagnosis`, `/diagnosis/`의 정적 HTML 연결 |
| `tools/`, `tests/` | 로컬 서버·미디어 도구·검증 코드 |
| `docs/implementation-report.md` | 변경 목록·검증 결과·남은 위험·후속 계획 |

## 영상 재생산

원본 4종은 제공받은 Desktop 폴더에 그대로 보존했습니다. 이미 생성한 웹 파일을 다시 변환할 필요는 없습니다. 재생산은 기존 결과를 보존한 별도 체크아웃에서 `assets/brand/`의 출력 파일이 없는 상태로 수행합니다. 스크립트는 기존 출력이 있으면 덮어쓰지 않고 중단합니다.

```sh
python3 tools/prepare_media.py '/원본/모션 영상'
python3 tools/verify_media.py '/원본/모션 영상'
```

준비 도구는 ffmpeg·ffprobe·Pillow, 검증 도구는 ffmpeg·NumPy를 사용합니다. 개발 작업에서는 이미 설치된 도구만 사용했습니다. 원본 HEVC 10비트를 H.264 8비트 1920×1080, 원본 24fps로 변환하며 오디오를 제외합니다. 인코딩 크롭은 하지 않고 CSS에서만 중앙 1:1 표시를 적용합니다.

## Git 및 배포 원칙

- 복구 기준본: `30f34d8` / `codex/ye-g-web-baseline`
- 기능 개발: `codex/ye-g-official-homepage`
- 구형 캐릭터 파일과 기존 백업 파일은 삭제하지 않았습니다.
- 원격 Push, Preview·Production 배포, 환경변수 변경은 별도 사용자 승인 이후 진행합니다.
- 후속 경로 `/about`, `/local`, `/news`, `/app`, `/contact`는 콘텐츠 확정 후 추가합니다. 현재는 작동하는 메인 섹션 링크만 제공합니다.
