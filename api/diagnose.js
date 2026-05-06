const REGION_CONTEXT = {
  "광주 전체": {
    type: "복합 생활권",
    traits: "상권별 성격 차이가 큰 지역입니다. 대학가, 주거지, 업무지구, 문화거리의 고객 흐름을 나눠 보는 편이 좋습니다.",
    angle: "선택 업종과 고객층에 맞춰 오프라인 접점과 온라인 검색 접점을 함께 점검합니다."
  },
  "충장로/동명동": {
    type: "문화·보행 상권",
    traits: "보행 유입, 카페·음식·패션 소비, 젊은 고객의 저장·후기 반응이 중요한 편입니다.",
    angle: "외관, 사진, 지도 저장, SNS 노출, 방문 후 리뷰 흐름을 함께 봅니다."
  },
  "상무지구": {
    type: "업무·회식 상권",
    traits: "직장인 점심, 저녁 모임, 회식, 빠른 선택과 예약·문의 전환이 중요한 편입니다.",
    angle: "시간대별 상품 구성, 예약 편의성, 플레이스 정보, 후기 신뢰도를 우선 봅니다."
  },
  "첨단지구": {
    type: "직주근접·신도심 상권",
    traits: "주거 고객과 직장인 고객이 섞여 있으며 반복 방문과 생활 편의 수요가 함께 나타나는 편입니다.",
    angle: "단골화 장치, 검색 노출, 퇴근 이후 수요, 가족·직장인 메시지를 나눠 봅니다."
  },
  "수완지구": {
    type: "주거·가족 상권",
    traits: "가족 단위, 생활밀착 소비, 학원·뷰티·외식 수요가 강한 편입니다.",
    angle: "신뢰, 후기, 재방문 혜택, 주말·평일 수요 차이를 함께 봅니다."
  },
  "전대후문": {
    type: "대학가 상권",
    traits: "학생 고객, 가격 민감도, 짧은 콘텐츠 반응, 빠른 유행 변화가 중요한 편입니다.",
    angle: "입문 가격, 이벤트, 숏폼·SNS 반응, 친구 추천 흐름을 우선 봅니다."
  },
  "양림동": {
    type: "문화·관광형 상권",
    traits: "목적 방문, 감성 공간, 사진·리뷰·스토리텔링의 영향이 큰 편입니다.",
    angle: "공간 이미지, 대표 상품, 방문 이유, 저장하고 싶은 콘텐츠 포인트를 봅니다."
  },
  "송정역": {
    type: "교통·방문객 상권",
    traits: "이동 고객, 외부 방문객, 짧은 체류 시간, 검색 기반 선택이 중요한 편입니다.",
    angle: "지도 검색, 빠른 설명, 대표 메뉴·서비스, 길찾기와 후기 노출을 우선 봅니다."
  },
  "봉선동": {
    type: "주거·교육 상권",
    traits: "학부모, 가족, 안정적인 단골 수요와 신뢰 기반 선택이 중요한 편입니다.",
    angle: "후기, 상담 전환, 재방문·재등록, 지역 커뮤니티 메시지를 함께 봅니다."
  },
  "백운동/남구": {
    type: "생활밀착 상권",
    traits: "근거리 생활 고객, 재방문, 전화 문의, 현장 접근성이 중요한 편입니다.",
    angle: "현장 가시성, 쉬운 설명, 단골 관리, 플레이스 기본 정보를 우선 봅니다."
  }
};

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function getOutputText(data) {
  if (typeof data.output_text === "string") return data.output_text.trim();
  if (!Array.isArray(data.output)) return "";

  return data.output
    .flatMap(item => Array.isArray(item.content) ? item.content : [])
    .map(part => part.text || part.output_text || "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

function pickRegionContext(region) {
  return REGION_CONTEXT[region] || REGION_CONTEXT["광주 전체"];
}

function buildPrompt(payload) {
  const profile = payload.profile || {};
  const scores = payload.scores || {};
  const context = payload.businessContext || {};
  const region = profile.region || "광주 전체";
  const regionContext = pickRegionContext(region);
  const existingActions = (payload.actions || []).filter(Boolean);
  const existingKpis = (payload.kpis || []).filter(Boolean);

  return {
    system: [
      "너는 광주 지역 소상공인을 위한 날카로운 마케팅 전략가다.",
      "역할은 기존 설문 결과를 다시 요약하는 것이 아니라, 지역×업종×고객층×채널 조건에서 왜 그 문제가 생겼는지 가설을 세우고 이번 주 실행안을 뽑는 것이다.",
      "반드시 기존 추천 액션과 KPI를 그대로 반복하지 말고, 더 구체적인 현장 문구, 콘텐츠 아이디어, 우선순위, 하지 말아야 할 일을 제안한다.",
      "지역 설명은 제공된 지역 맥락을 기준으로 하며, 최신 통계나 실제 점포 현황처럼 확인되지 않은 사실은 단정하지 않는다.",
      "모호한 표현을 피하고, 사장이 바로 따라 할 수 있는 문장과 순서로 작성한다.",
      "컨설턴트처럼 단호하게 쓰되 불안 조장, 과장, 투자 권유, 개발 과정 설명은 쓰지 않는다.",
      "한국어로 작성한다."
    ].join(" "),
    user: JSON.stringify({
      requestedOutput: {
        diagnosis: "기존 결과와 다른 관점의 핵심 판단 2문장",
        localHypothesis: "이 지역에서 이 문제가 생기는 이유를 고객 행동 가설로 설명",
        positioning: "이 매장이 잡아야 할 한 줄 포지션",
        copyExamples: "네이버 플레이스, SNS, 현장 안내 문구 예시 각 1개",
        sevenDayPlan: "7일 실행 순서",
        kpis: "이번 주 확인할 KPI 4개와 보는 이유",
        avoid: "지금 하면 안 되는 착각 2개"
      },
      businessProfile: profile,
      businessContext: {
        representativeProductOrService: context.product || "입력 없음",
        storeStrength: context.strength || "입력 없음",
        currentProblem: context.problem || "입력 없음",
        nearbyCompetitorMood: context.competitor || "입력 없음",
        currentPromotion: context.promotion || "입력 없음",
        monthlyGoal: context.goal || "입력 없음"
      },
      diagnosis: {
        resultType: payload.resultType,
        weakest: payload.weakest,
        strongest: payload.strongest,
        summary: payload.summary,
        currentInsight: payload.insight,
        scores
      },
      currentRecommendations: {
        actions: existingActions,
        kpis: existingKpis
      },
      regionContext: {
        region,
        type: regionContext.type,
        traits: regionContext.traits,
        angle: regionContext.angle
      },
      instruction: [
        "아래 형식 그대로 작성해라. 각 항목 제목은 바꾸지 마라.",
        "기존 추천 액션과 같은 문장을 반복하지 마라.",
        "지역명, 업종, 고객층, 판매 채널이 모든 핵심 판단에 드러나야 한다.",
        "대표 상품/서비스나 현재 고민이 입력되어 있으면 반드시 반영해라.",
        "입력 없음이라고 되어 있는 항목은 추측하지 말고 업종·지역 기준의 실행안으로 대체해라.",
        "",
        "핵심 판단:",
        "-",
        "",
        "왜 이 상권에서 이 문제가 생기는가:",
        "-",
        "",
        "잡아야 할 포지션:",
        "-",
        "",
        "바로 쓸 문구:",
        "- 플레이스:",
        "- SNS:",
        "- 현장:",
        "",
        "7일 실행 순서:",
        "1일차:",
        "2일차:",
        "3일차:",
        "4일차:",
        "5일차:",
        "6일차:",
        "7일차:",
        "",
        "이번 주 KPI:",
        "-",
        "-",
        "-",
        "-",
        "",
        "하지 말아야 할 착각:",
        "-",
        "-"
      ].join("\n")
    })
  };
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return sendJson(res, 200, { ok: true });
  }

  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "POST 요청만 사용할 수 있습니다." });
  }

  if (!process.env.OPENAI_API_KEY) {
    return sendJson(res, 500, { error: "Vercel 환경변수 OPENAI_API_KEY가 아직 등록되지 않았습니다." });
  }

  let payload = req.body;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch (error) {
      return sendJson(res, 400, { error: "요청 데이터를 읽을 수 없습니다." });
    }
  }

  if (!payload || typeof payload !== "object" || !payload.profile || !payload.scores) {
    return sendJson(res, 400, { error: "진단에 필요한 사업 정보가 부족합니다." });
  }

  const prompt = buildPrompt(payload);

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-5-mini",
        input: [
          { role: "system", content: [{ type: "input_text", text: prompt.system }] },
          { role: "user", content: [{ type: "input_text", text: prompt.user }] }
        ],
        max_output_tokens: 1400
      })
    });

    const data = await response.json();

    if (!response.ok) {
      const message = data.error && data.error.message ? data.error.message : "AI 응답 생성에 실패했습니다.";
      return sendJson(res, response.status, { error: message });
    }

    const result = getOutputText(data);
    if (!result) {
      return sendJson(res, 502, { error: "AI 응답을 읽을 수 없습니다." });
    }

    return sendJson(res, 200, { result });
  } catch (error) {
    return sendJson(res, 500, { error: "AI 진단 요청 중 문제가 발생했습니다." });
  }
};
