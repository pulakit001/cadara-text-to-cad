# Legal and Release Baseline

This document is a practical product baseline, not legal advice and not a substitute for a jurisdiction-specific review.

## Product disclosures

- Cadara sends prompts and optional reference images to the AI provider selected by the user. Provider privacy, retention, security, and cross-border transfer terms apply.
- API keys and local design history are stored on the user's device. Users should avoid entering secrets or confidential personal data into prompts or reference images.
- Generated CAD is an AI-assisted design proposal. Users must verify dimensions, units, tolerances, materials, clearances, intellectual-property rights, safety factors, and applicable standards before manufacture or safety-critical use.
- Cadara is licensed under the MIT License. Third-party packages and AI providers have separate licenses and terms.

## India readiness checklist

Before offering the application or a connected service in India, obtain a legal review that covers the Digital Personal Data Protection Act, 2023 and rules in force. Confirm, at minimum:

- who the data fiduciary or controller is and how users can contact that entity;
- what personal data is collected, why it is processed, the applicable notice and consent flow, and how consent can be withdrawn;
- retention, deletion, correction, access, and grievance handling procedures;
- security safeguards, incident response, processor agreements, and cross-border transfers;
- requirements for children’s data, sensitive workflows, and any sector-specific rules;
- terms of use, acceptable use, copyright and trademark notices, export controls, and the rights granted for user-uploaded material.

The in-app Legal & Help panel surfaces the user-facing version of these warnings and links to official Indian sources. The final privacy notice, terms of use, contact details, and grievance process must be completed with the responsible legal entity's information before commercial launch.

## Distribution checklist

- Sign Windows installers with an Authenticode certificate.
- Sign and notarize macOS applications with an Apple Developer account.
- Publish checksums and release notes with every installer.
- Keep an accurate third-party notices inventory for Electron, build123d, cadquery-ocp, and other bundled dependencies.
- Test each installer on a clean supported operating-system image before publishing.

## Official references

- [Digital Personal Data Protection Act, 2023](https://www.indiacode.nic.in/handle/123456789/19598)
- [MeitY data protection framework](https://www.meity.gov.in/data-protection-framework)
- [MIT License](./LICENSE)