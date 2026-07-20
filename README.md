# Kindred Objects

A privacy-first prototype for stateful, conversational object twins. Point a phone camera at a meaningful household object, give it a grounded personality, and preserve confirmed changes as an append-only history.

## Run locally

```bash
npm install
npm run dev
```

Camera access requires `localhost` or HTTPS. Speech input uses the browser Web Speech API when available; speech output uses `speechSynthesis`.

## What the prototype implements

- Mobile-first camera and voice experience
- Immediate spoken “Picture taken” feedback, camera shutdown, and automatic progression
- One-question-at-a-time hands-free enrollment with voice commands and keyboard fallback
- Local visual fingerprints and explicit identity confirmation
- Three typed state schemas: sentimental item, appliance, and personal belonging
- Structured state proposals with confidence and safety confirmation
- Append-only state history with caregiver corrections
- Grounded first-person object personalities
- Local persistence, data export, deletion, and PWA metadata
- Dementia-care boundaries: no diagnosis, medication decisions, emergency claims, or hidden monitoring

The local matching algorithm is deliberately lightweight: it compares normalized color histograms. It demonstrates the identity boundary and confirmation UX, not production-grade object re-identification. A production adapter should replace it with multi-view visual embeddings while preserving the same ambiguity policy.

## Data flow

1. A frame is sampled only after the user taps **Take picture**.
2. The frame is reduced to a 48-value histogram in the browser and discarded.
3. The app vibrates, says “Picture taken,” turns the camera off, and advances automatically.
4. Similarity search proposes a twin; the user confirms the identity by voice or button.
5. New objects are introduced through a guided voice interview after they can be put down.
6. Spoken or typed observations are parsed against the category’s allowed state schema.
7. Consequential, medication-related, low-confidence, or ambiguous changes require spoken or visible confirmation.
8. Accepted changes create immutable events and update the current state.
9. Object responses retrieve only from the approved profile and confirmed state.

## Verification

```bash
npm run lint
npm test
npm run build
```

The automated suite covers state extraction, confirmation rules, corrections, medical boundaries, grounding, and fingerprint matching.

## Prototype limits

This is a memory-support prototype, not a medical device or autonomous safety system. It only knows what was shown or reported during a session. It cannot infer events that occurred while the camera was off, and it must never replace human care or supervision.
# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
