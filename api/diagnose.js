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

function compact(value, fallback) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function buildPrompt(payload) {
  const profile = payload.profile || {};
  const context = payload.businessContext || {};
  const regionContext = payload.regionContext || {};
  const industryContext = payload.industryContext || {};
  const channelContext = payload.channelContext || {};
  const scores = payload.scores || {};
  const weakest = payload.weakest || {};

  return {
    system: [
      "너는 광주 로컬상권 마케팅 실행 코치 '예지'다.",
      "너의 목표는 뻔한 마케팅 조언이 아니라, 점주가 오늘 바로 복사해서 쓸 수 있는 문구와 7일 실행표를 만드는 것이다.",
      "금지어: '브랜딩 강화', 'SNS 활성화', '리뷰 관리', '콘텐츠를 꾸준히 올리세요'처럼 구체 행동이 없는 말.",
      "모든 제안은 지역, 업종, 고객층, 대표 상품/서비스, 현재 고민 중 최소 3개 이상을 엮어야 한다.",
      "지역 정보는 제공된 지역 맥락을 기준으로 해석하고, 실제 통계나 특정 경쟁 점포 상황을 아는 것처럼 단정하지 않는다.",
      "친근하지만 단호하게 쓴다. 과장, 투자 권유, 개발 과정 설명은 쓰지 않는다.",
      "한국어로 작성한다."
    ].join(" "),
    user: JSON.stringify({
      serviceContext: "광주형 AI 로컬상권 마케팅 진단·실행 서비스. 캐릭터 예지가 점포별 실행 미션, 콘텐츠 문구, 리뷰 답글, 이벤트 아이디어를 제안한다.",
      businessProfile: {
        industry: compact(profile.industry, "업종 미입력"),
        region: compact(profile.region, "광주 전체"),
        operationType: compact(profile.operationType, "혼합"),
        businessYear: compact(profile.businessYear, "운영 기간 미입력"),
        customerGroup: compact(profile.customerGroup, "고객층 미입력"),
        salesChannel: compact(profile.salesChannel, "채널 미입력")
      },
      businessContext: {
        product: compact(context.product, "대표 상품/서비스 미입력"),
        strength: compact(context.strength, "매장 강점 미입력"),
        problem: compact(context.problem, "현재 고민 미입력"),
        competitor: compact(context.competitor, "주변 경쟁 느낌 미입력"),
        promotion: compact(context.promotion, "현재 홍보 방식 미입력"),
        goal: compact(context.goal, "이번 달 목표 미입력")
      },
      localContext: {
        type: compact(regionContext.type, "광주 로컬상권"),
        audience: compact(regionContext.audience, "지역 고객"),
        tension: compact(regionContext.tension, "상권 메시지가 흐릴 수 있음"),
        proof: compact(regionContext.proof, "저장/문의/방문 전환")
      },
      industryContext: {
        trigger: compact(industryContext.trigger, "대표 가치"),
        hook: compact(industryContext.hook, "선택 이유"),
        event: compact(industryContext.event, "첫 이용 혜택")
      },
      channelContext: {
        focus: compact(channelContext.focus, "핵심 채널"),
        copy: compact(channelContext.copy, "첫 문구 정비")
      },
      currentRuleBasedReport: {
        resultType: payload.resultType,
        summary: payload.resultSummary,
        insight: payload.resultInsight,
        position: payload.position,
        copy: payload.copy,
        actions: payload.actions,
        kpis: payload.kpis,
        sprint: payload.sprint,
        weakest,
        scores
      },
      instruction: [
        "아래 제목과 순서를 그대로 사용해라.",
        "기존 리포트 문장을 복사하지 말고, 더 구체적인 문구와 실행으로 확장해라.",
        "문장마다 가능한 한 명사와 행동을 넣어라. 예: '대표 사진 3장 교체', '플레이스 첫 줄 수정', '리뷰 답글 5개 작성'.",
        "입력값이 미입력인 부분은 억지로 꾸미지 말고, 업종·지역 기준의 기본 실행으로 대체해라.",
        "",
        "예지의 냉정한 판단",
        "- 2문장. 왜 지금 이 매장은 같은 업종의 다른 매장과 구분이 약한지 설명.",
        "",
        "이 상권에서 먹히는 각도",
        "- 고객이 어떤 순간에 이 매장을 선택할지 가설 2개.",
        "",
        "오늘 바로 바꿀 3가지",
        "1.",
        "2.",
        "3.",
        "",
        "복사해서 쓸 문구",
        "- 네이버 플레이스 첫 줄:",
        "- SNS 게시글:",
        "- 현장 안내:",
        "- 리뷰 답글:",
        "",
        "7일 실행표",
        "1일차:",
        "2일차:",
        "3일차:",
        "4일차:",
        "5일차:",
        "6일차:",
        "7일차:",
        "",
        "이번 주에 볼 숫자",
        "- KPI 4개. 각 KPI마다 왜 보는지 1줄.",
        "",
        "버릴 선택지",
        "- 지금 하지 말아야 할 일 2개와 이유."
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
        max_output_tokens: 1700
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
