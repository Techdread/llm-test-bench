import { html } from 'htm/preact';

export function LessonsPanel({ lesson }) {
  return html`
    <section class="panel lesson-panel">
      <div class="panel-header"><span><i class="fa-solid fa-graduation-cap"></i> Lesson</span><span>${lesson.difficulty}</span></div>
      <div class="lesson-body" tabindex="0" role="region" aria-label="Lesson">
        <h2>${lesson.title}</h2>
        <p>${lesson.topic}</p>
        <div class="goal-list">
          ${lesson.lessonGoals.map(goal => html`<span key=${goal}>${goal}</span>`)}
        </div>
        <div class="walkthrough">
          <strong>Walkthrough</strong>
          ${lesson.walkthrough.map((step, index) => html`<div key=${index}>${index + 1}. ${step}</div>`)}
        </div>
        <div class="challenge">
          <strong>Challenge</strong>
          <span>${lesson.challenge}</span>
        </div>
      </div>
    </section>
  `;
}
