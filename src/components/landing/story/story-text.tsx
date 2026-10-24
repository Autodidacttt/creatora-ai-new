import { STORY } from "./copy";

/** Visually hidden text version of the whole story, for screen readers (the animated stage is aria-hidden). */
export function StoryText() {
  const { intro, network, creator, brief, proof, rights, verified, release, cta } = STORY;
  return (
    <article className="sr-only" aria-labelledby="story-text-title">
      <h2 id="story-text-title">How Creatora works</h2>
      <h3>{intro.title} {intro.accent}.</h3>
      <p>{intro.body}</p>
      <h3>{network.title}</h3>
      <p>{network.body}</p>
      <h3>{creator.name}, {creator.role} ({creator.tag})</h3>
      <p>{creator.meta.map(([n, l]) => `${n} ${l}`).join(", ")}. Skills: {creator.skills.join(", ")}. Workflow: {creator.workflow.join(", then ")}.</p>
      <h3>{brief.title}</h3>
      <p>Brief: {brief.text}</p>
      <ul>{brief.rows.map((r) => <li key={r.name}>{r.name}: relevance {r.score}, {r.tools}</li>)}</ul>
      <p>{brief.note}</p>
      <h3>{proof.title}</h3>
      <ul>{proof.layers.map((l) => <li key={l.title}>{l.title}: {l.body}</li>)}</ul>
      <p>{proof.note}</p>
      {[rights, verified].map((sec) => (
        <section key={sec.title}>
          <h3>{sec.title}</h3>
          <ul>{sec.checks.map((c) => <li key={c.title}>{c.title}: {c.body}</li>)}</ul>
          <p>{sec.note}</p>
        </section>
      ))}
      <h3>{release.title}</h3>
      <ol>{release.steps.map((st) => <li key={st.title}>{st.title}: {st.body}</li>)}</ol>
      <p>{release.note}</p>
      <h3>{cta.title}</h3>
      <p>{cta.body}</p>
    </article>
  );
}
