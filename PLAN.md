# Extension Structure and Requirements

## Overview
This VSCode extension will scan the current workspace for:
- Dependency files (e.g., requirements.txt, package.json)
- Source code files for security issues

It will use the OpenAI ChatGPT API to analyze:
- Dependency vulnerabilities (by sending the dependency file contents)
- Code issues (by sending code snippets or files for analysis)

## Key Features
- Detect and parse dependency files
- Detect and scan source code files for security issues (SQL injection, hardcoded secrets, improper input validation, etc.)
- Use ChatGPT to analyze both dependencies and code
- Display detected issues in the VSCode UI (Problems panel or a custom view)
- Well-documented with a README for installation and usage

## Project Structure
```
project-root/
├── src/
│   ├── extension.ts         # Main extension entry point
│   ├── dependencyScanner.ts # Logic for dependency file detection and analysis
│   ├── codeScanner.ts       # Logic for code scanning and analysis
│   └── chatgptApi.ts        # ChatGPT API integration
├── package.json             # Extension manifest
├── tsconfig.json            # TypeScript configuration
├── README.md                # Documentation
├── TODO.md                  # Task progress
└── PLAN.md                  # This plan
```

## Implementation Steps
1. Scaffold the extension using VSCode's Yeoman generator (yo code) or manually.
2. Implement dependency file detection and parsing.
3. Integrate ChatGPT API for dependency analysis.
4. Implement code scanning for security issues.
5. Integrate ChatGPT API for code issue analysis.
6. Display results in the VSCode UI.
7. Write documentation and usage instructions.
8. Test and polish the extension.

## Notes
- The extension will require an OpenAI API key from the user (to be set in extension settings).
- For large codebases, the extension may need to chunk files or limit analysis to avoid token limits.
- The extension will only scan the workspace currently open in VSCode.
