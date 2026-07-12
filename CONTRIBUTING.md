# Contributing to Jarvis Agent

First off, thank you for considering contributing to Jarvis Agent! 

## 🚀 How to Contribute

### 1. Setup the project locally
1. Fork and clone the repository.
2. Install the dependencies:
   ```bash
   npm install
   ```
3. To test the extension, open the repository in VS Code and press `F5` to launch the **Extension Development Host**.

### 2. Making Changes
- Create a new branch (`git checkout -b feature/my-new-feature` or `bugfix/issue-123`).
- Make your changes.
- Ensure your code passes linting and tests (if configured):
  ```bash
  npm run lint
  npm run test
  ```

### 3. Submitting a Pull Request
- Push your branch to your fork.
- Open a Pull Request against the `main` branch.
- Fill out the Pull Request template completely.
- Add a line to `CHANGELOG.md` under `[Unreleased]` describing your change.
- Wait for a maintainer to review your code.

### 4. Screenshots & Demo Media
`docs/media/` currently only contains a placeholder (`.gitkeep`) — the screenshots and demo clips referenced conceptually in `README.md` still need to be captured from a real Extension Development Host session (chat panel, Cmd+K inline edit, settings panel, onboarding screen). If you add one, reference it from `README.md` with a relative path (`docs/media/your-file.png`) and keep videos short (<15s, <10MB) so the repo stays lightweight.

## 🐛 Reporting Bugs
If you find a bug, please use the **Bug Report** issue template and provide as much detail as possible, including VS Code version, OS, and any error logs from the Output panel.

## 💡 Proposing Features
For feature requests, use the **Feature Request** issue template. We love new ideas!
