# Codebase Dependency & Security Analyzer

A Visual Studio Code extension that scans your codebase for dependency vulnerabilities and security issues using ChatGPT.

## Features

- **Dependency Analysis:** Scans `requirements.txt` and `package.json` for dependencies and checks for known vulnerabilities using ChatGPT.
- **Code Security Analysis:** Scans source code files (`.py`, `.js`, `.ts`, `.jsx`, `.tsx`, `.java`, `.c`, `.cpp`, `.cs`, `.go`, `.rb`, `.php`) for issues such as SQL injection, hardcoded secrets, and improper input validation.
- **Results in Problems Panel:** Detected issues are shown in the VSCode Problems panel with file and line number.
- **Detailed Output:** Dependency analysis results are shown in a dedicated output channel.

## Installation

1. Clone or download this repository.
2. Run `npm install` to install dependencies.
3. Run `npm run compile` to build the extension.
4. Open the project in VSCode.
5. Press `F5` to launch a new Extension Development Host window.

## Packaging the Extension

To generate a `.vsix` file (the distributable package for your VSCode extension):

1. Make sure all dependencies are installed:
   ```sh
   npm install
   ```

2. Build the extension:
   ```sh
   npm run compile
   ```

3. Package the extension using the VSCE tool (no install required):
   ```sh
   npx @vscode/vsce package
   ```
   This will create a `.vsix` file in your project directory.

4. You can now install the `.vsix` file in VSCode by running:
   - Open Command Palette (`Ctrl+Shift+P`)
   - Select `Extensions: Install from VSIX...`
   - Choose your generated `.vsix` file

## Usage

1. Set your OpenAI API key in the extension settings:
   - Open Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`).
   - Search for `Preferences: Open Settings (UI)`.
   - Search for `Codebase Analyzer` and enter your OpenAI API key.

2. Run the scan:
   - Open Command Palette and search for `Scan Codebase for Vulnerabilities`.
   - The extension will scan for dependencies and code issues.
   - Dependency analysis results will appear in the "Dependency Analysis" output channel.
   - Code issues will appear in the Problems panel.

## How It Works

- The extension scans the workspace for dependency files and source code files.
- It sends the list of dependencies and code snippets to ChatGPT for analysis.
- ChatGPT returns a list of vulnerabilities and issues, which are displayed in the VSCode UI.

## Requirements

- Node.js and npm installed.
- An OpenAI API key (for ChatGPT access).

## Limitations

- Analysis is limited by ChatGPT's context window (token limit).
- For large codebases, only a subset of files may be analyzed at a time.

## License

MIT
