// Presentation only. The original text remains the source for every export.
const raw = document.getElementById('aiOutput');
const report = document.getElementById('aiReadable');
const headings = new Set([
  '예지의 냉정한 판단', '이 상권에서 먹히는 각도', '오늘 바로 바꿀 3가지',
  '복사해서 쓸 문구', '7일 실행표', '이번 주에 볼 숫자', '버릴 선택지'
]);

export function renderAiReport(text) {
  const fragment = document.createDocumentFragment();
  for (const line of text.match(/[^\n]*\n|[^\n]+$/g) || []) {
    const title = line.trim().replace(/^#{1,6}\s+/, '').replace(/^\*\*(.*?)\*\*$/, '$1').replace(/:$/, '');
    const element = document.createElement(headings.has(title) ? 'h4' : 'div');
    element.className = headings.has(title) ? 'ai-section-title' : 'ai-line';
    if (/^\s*(?:\d+[.)]\s|\d+일차)/.test(line)) element.classList.add('ai-action');
    else if (/^\s*[-*•]\s/.test(line)) element.classList.add('ai-list-line');
    element.textContent = line;
    fragment.append(element);
  }
  report.replaceChildren(fragment);
  if (!report.childElementCount || report.textContent !== text) {
    throw new Error('AI 실행안을 표시하지 못했습니다. 다시 생성해 주세요.');
  }
  raw.textContent = text;
  return report;
}

function updateAccessibility() {
  document.querySelectorAll('.step-tab').forEach(button => {
    if (button.classList.contains('active')) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  });
  document.querySelectorAll('.chip, .scale button').forEach(button => {
    button.setAttribute('aria-pressed', String(button.classList.contains('active')));
  });
  document.querySelectorAll('.question').forEach(question => {
    question.setAttribute('role', 'group');
    question.setAttribute('aria-label', question.querySelector('p').textContent);
  });
}
new MutationObserver(updateAccessibility).observe(document.getElementById('stepTabs'), { childList: true });
updateAccessibility();
document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  const label = button.textContent;
  const group = button.closest('.choices')?.dataset.choice;
  const question = button.closest('.question')?.querySelector('p').textContent;
  setTimeout(() => {
    if (button.matches('.step-tab, #nextBtn, #prevBtn')) {
      updateAccessibility();
      document.querySelector('.step-page:not(.hidden)').focus({ preventScroll: true });
    }
    if (button.matches('.chip, .scale button')) {
      updateAccessibility();
      const candidates = group
        ? document.querySelectorAll('[data-choice="' + group + '"] button')
        : [...document.querySelectorAll('.question')].find(item => item.querySelector('p').textContent === question)?.querySelectorAll('button');
      [...(candidates || [])].find(item => item.textContent === label)?.focus({ preventScroll: true });
    }
  });
}, { capture: true });
