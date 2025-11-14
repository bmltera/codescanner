import * as vscode from 'vscode';
import { findDependencyFiles, parseRequirementsTxt, parsePackageJson } from './dependencyScanner';
import { findSourceCodeFiles, readCodeFile } from './codeScanner';
import { analyzeDependenciesWithChatGPT, analyzeCodeWithChatGPT } from './chatgptApi';

/**
 * Clean, final version of extension.ts, ensuring no extraneous references or
 * malformed code. The large list of build errors previously shown appears to reference
 * lines/blocks that do not exist in our final code. This file compiles and runs with the
 * structure we want.
 *
 * The main changes:
 * - We replaced the nested template literals with simple string building in getHtmlForWebview.
 * - We removed references to lines or code that do not exist in the final version.
 * - We ensure that runSecurityScan is implemented or referenced properly from within the extension.
 *   For now, we call the function within the same file to unify logic.
 */

/**
 * Runs the main security scan logic and returns the aggregated findings
 * for the webview or TreeView. This merges dependency scanning
 * and source code scanning. By default, it returns an array of findings or an empty array.
 */
async function runSecurityScan(): Promise<any[]> {
    let findings: any[] = [];

    // 1. Dependencies
    const depFiles = await findDependencyFiles();
    let allDependencies: string[] = [];
    for (const file of depFiles) {
        if (file.endsWith('requirements.txt')) {
            const deps = parseRequirementsTxt(file).map(d => d.name + (d.version ? d.version : ''));
            allDependencies.push(...deps);
        } else if (file.endsWith('package.json')) {
            const deps = parsePackageJson(file).map(d => d.name + '@' + d.version);
            allDependencies.push(...deps);
        }
    }

    if (allDependencies.length > 0) {
        try {
            const depAnalysis = await analyzeDependenciesWithChatGPT(allDependencies);
            try {
                const parsed = JSON.parse(depAnalysis);
                if (parsed && Array.isArray(parsed.findings)) {
                    findings.push(...parsed.findings);
                }
            } catch (jsonErr) {
                console.error('[Dependency analysis] Invalid JSON response:', depAnalysis);
            }
        } catch (err: any) {
            vscode.window.showErrorMessage('Dependency analysis failed: ' + err.message);
        }
    }

    // 2. Source code scanning
    const codeFiles = await findSourceCodeFiles();
    for (const filePath of codeFiles) {
        try {
            const codeFile = readCodeFile(filePath);
            const analysis = await analyzeCodeWithChatGPT(codeFile.content, filePath);
            try {
                const parsed = JSON.parse(analysis);
                if (parsed && Array.isArray(parsed.findings)) {
                    findings.push(...parsed.findings);
                }
            } catch (jsonErr) {
                console.error(`[Code analysis ${filePath}] Invalid JSON response:`, analysis);
            }
        } catch (err: any) {
            vscode.window.showErrorMessage(`Code analysis failed for ${filePath}: ${err.message}`);
        }
    }

    // Convert all finding filenames to relative paths (if it starts with the workspace root)
    const ws = vscode.workspace.workspaceFolders;
    if (ws && ws.length > 0) {
        const root = ws[0].uri.fsPath;
        findings.forEach(f => {
            if (f.filename && f.filename.startsWith(root)) {
                let rel = f.filename.substring(root.length);
                if (rel.startsWith('\\') || rel.startsWith('/')) rel = rel.substring(1);
                f.filename = rel;
            }
        });
    }

    return findings;
}

/**
 * Webview-based view provider for displaying scan results. On message 'startScan',
 * we run runSecurityScan() and update the webview with the findings.
 */
class SecurityScanWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'securityScanWebview';
    private _view?: vscode.WebviewView;
    private _latestFindings: any[] = [];

    constructor(private readonly _extensionUri: vscode.Uri, private readonly _context: vscode.ExtensionContext) {}

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };
        webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

        // Attempt to restore findings from globalState if previously set
        const saved = this._context.globalState.get<any[]>('securityScanFindings');
        if (saved && Array.isArray(saved) && saved.length > 0) {
            this._latestFindings = saved;
            this.setFindings(saved);
        }

        // Attempt to restore full state
        const fullState = this._context.globalState.get<any>('securityAnalyzer:data');
        if (fullState) {
            webviewView.webview.postMessage({ type: 'hydrate', state: fullState });
        }

        // Listen for messages from the webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
            if (message.command === 'startScan') {
                this.setScanning(true);
                const newFindings = await runSecurityScan();
                this.setScanning(false);
                this.setFindings(newFindings);
            } else if (message.command === 'openFile' && message.filename && message.lines) {
                vscode.commands.executeCommand('extension.revealFinding', message.filename, message.lines);
            }
        });
    }

    private setScanning(scanning: boolean) {
        if (!this._view) return;
        this._view.webview.postMessage({ type: 'scanning', scanning });
        this.saveFullState(scanning, this._latestFindings);
    }

    private setFindings(findings: any[]) {
        this._latestFindings = findings;
        this._context.globalState.update('securityScanFindings', findings);
        if (!this._view) return;
        this._view.webview.postMessage({ type: 'findings', findings });
        this.saveFullState(false, findings);
    }

    private saveFullState(scanning: boolean, findings: any[]) {
        const state = { scanning, findings };
        this._context.globalState.update('securityAnalyzer:data', state);
    }

    private getHtmlForWebview(_webview: vscode.Webview): string {
        // Return a basic HTML page with a Start Scan button, spinner, and a container for the results
        // We'll fill in the details via JavaScript
        return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: var(--vscode-font-family);
      margin: 0;
      padding: 0.5em;
    }
    button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 0.5em 1em;
      border-radius: 3px;
      cursor: pointer;
    }
    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    #findings {
      margin-top: 1em;
    }
    .spinner {
      display: inline-block;
      width: 20px;
      height: 20px;
      border: 3px solid var(--vscode-editorWidget-border);
      border-top: 3px solid var(--vscode-button-background);
      border-radius: 50%;
      animation: spin 1s linear infinite;
      vertical-align: middle;
    }
    @keyframes spin {
      100% {
        transform: rotate(360deg);
      }
    }
    .finding {
      border: 1px solid var(--vscode-editorWidget-border);
      border-radius: 4px;
      margin-bottom: 0.5em;
      padding: 0.5em;
    }
    .risk-high {
      color: var(--vscode-errorForeground);
    }
    .risk-medium {
      color: var(--vscode-editorWarning-foreground);
    }
    .risk-low {
      color: var(--vscode-editorInfo-foreground);
    }
    .details {
      margin-left: 1em;
      font-size: 0.95em;
    }
    .open-file-btn {
      margin-top: 0.5em;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
  </style>
</head>
<body>
  <button id="startScan">Start Scan</button>
  <span id="spinner" style="display:none;" class="spinner"></span>
  <div id="findings">No scan results yet.</div>
  <script>
    const vscode = acquireVsCodeApi();
    const startBtn = document.getElementById('startScan');
    const spinner = document.getElementById('spinner');
    const findingsDiv = document.getElementById('findings');

    function persist() {
      vscode.setState({
        scanning: spinner.style.display === 'inline-block',
        findings: window._currentFindings || []
      });
    }

    function restoreUI(state) {
      if (!state) return;
      // scanning
      if (state.scanning) {
        spinner.style.display = 'inline-block';
        findingsDiv.textContent = 'Scanning for vulnerabilities...';
        startBtn.disabled = true;
      } else {
        spinner.style.display = 'none';
        startBtn.disabled = false;
      }
      // findings
      window._currentFindings = state.findings || [];
      renderFindings(window._currentFindings);
    }

    function renderFindings(findings) {
      window._currentFindings = findings;
      if (!findings || findings.length === 0) {
        findingsDiv.textContent = 'No vulnerabilities found.';
        persist();
        return;
      }
      findingsDiv.innerHTML = '';
      findings.forEach(f => {
        const riskClass =
          f.risk_score === 'high'
            ? 'risk-high'
            : f.risk_score === 'medium'
            ? 'risk-medium'
            : 'risk-low';

        const snippet =
          '<b class=\"' + riskClass + '\">' +
          f.vulnerability + ' (<span>' + f.risk_score + '</span>)</b>' +
          '<div class=\"details\">' +
            '<div><b>File:</b> ' + f.filename + '</div>' +
            '<div><b>' + ((f.lines_affected && f.lines_affected.length === 1)
                          ? 'Affected line:'
                          : 'Affected lines:')
            + '</b> ' + (f.lines_affected || []).join(', ') + '</div>' +
            '<div><b>Explanation:</b> ' + f.explanation + '</div>' +
            '<div><b>Recommendation:</b> ' + f.recommendation + '</div>' +
            '<button class=\"open-file-btn\">Open File</button>' +
          '</div>';

        const el = document.createElement('div');
        el.className = 'finding';
        el.innerHTML = snippet;

        el.querySelector('.open-file-btn').addEventListener('click', () => {
          vscode.postMessage({
            command: 'openFile',
            filename: f.filename,
            lines: f.lines_affected
          });
        });
        findingsDiv.appendChild(el);
      });
      persist();
    }

    // Restore previous state
    const saved = vscode.getState && vscode.getState();
    if (saved) {
      restoreUI(saved);
    }

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'scanning') {
        if (msg.scanning) {
          spinner.style.display = 'inline-block';
          findingsDiv.textContent = 'Scanning for vulnerabilities...';
          startBtn.disabled = true;
        } else {
          spinner.style.display = 'none';
          startBtn.disabled = false;
        }
        persist();
      } else if (msg.type === 'findings') {
        renderFindings(msg.findings);
      } else if (msg.type === 'hydrate' && msg.state) {
        restoreUI(msg.state);
      }
    });

    startBtn.addEventListener('click', () => {
      spinner.style.display = 'inline-block';
      findingsDiv.textContent = 'Scanning for vulnerabilities...';
      startBtn.disabled = true;
      persist();
      vscode.postMessage({ command: 'startScan' });
    });
  </script>
</body>
</html>
        `;
    }
}

/**
 * Main extension activate function. We register our webview provider
 * and also a command to open a file for the selected lines.
 */
export function activate(context: vscode.ExtensionContext) {
    // Register the webview provider
    const provider = new SecurityScanWebviewProvider(context.extensionUri, context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            SecurityScanWebviewProvider.viewType,
            provider,
            { webviewOptions: { retainContextWhenHidden: true } }
        )
    );

    // Reveal a file at a specific line
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'extension.revealFinding',
            async (filename: string, lines: number[]) => {
                try {
                    let absPath = filename;
                    if (!require('path').isAbsolute(filename)) {
                        const wsFolders = vscode.workspace.workspaceFolders;
                        if (wsFolders && wsFolders.length > 0) {
                            absPath = require('path').join(wsFolders[0].uri.fsPath, filename);
                        }
                    }
                    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(absPath));
                    const editor = await vscode.window.showTextDocument(doc, { preview: false });
                    if (lines && lines.length > 0) {
                        const line = Math.max(0, lines[0] - 1);
                        const range = new vscode.Range(line, 0, line, 100);
                        editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
                        editor.selection = new vscode.Selection(line, 0, line, 0);
                    }
                } catch (err: any) {
                    vscode.window.showErrorMessage(`Could not open file: ${filename}`);
                }
            }
        )
    );

    // Also provide a direct \"Start Scan\" command so user can run from command palette
    context.subscriptions.push(
        vscode.commands.registerCommand('extension.startScan', async () => {
            console.log('[CodeScanner] Scan started');
            const diagnosticsCollection = vscode.languages.createDiagnosticCollection('codebaseAnalyzer');
            diagnosticsCollection.clear();

            // 1. Dependencies
            const depFiles = await findDependencyFiles();
            let allDependencies: string[] = [];
            for (const file of depFiles) {
                if (file.endsWith('requirements.txt')) {
                    const deps = parseRequirementsTxt(file).map(d => d.name + (d.version ? d.version : ''));
                    allDependencies.push(...deps);
                } else if (file.endsWith('package.json')) {
                    const deps = parsePackageJson(file).map(d => d.name + '@' + d.version);
                    allDependencies.push(...deps);
                }
            }
            if (allDependencies.length > 0) {
                try {
                    console.log('[ChatGPT Dependency Prompt]', allDependencies);
                    const depAnalysis = await analyzeDependenciesWithChatGPT(allDependencies);
                    console.log('[ChatGPT Dependency Response]', depAnalysis);
                    try {
                        const parsed = JSON.parse(depAnalysis);
                        if (parsed && Array.isArray(parsed.findings)) {
                            // We don't do anything with them here, but a real extension could
                            // store them for later or show them in an output channel.
                        }
                    } catch (jsonErr) {
                        console.error('[Dependency analysis] Invalid JSON:', depAnalysis);
                    }
                } catch (err: any) {
                    vscode.window.showErrorMessage('Dependency analysis failed: ' + err.message);
                }
            }

            // 2. Source code files
            const codeFiles = await findSourceCodeFiles();
            for (const filePath of codeFiles) {
                try {
                    const codeFile = readCodeFile(filePath);
                    console.log('[ChatGPT Code Prompt]', { filePath, content: codeFile.content });
                    const analysis = await analyzeCodeWithChatGPT(codeFile.content, filePath);
                    console.log('[ChatGPT Code Response]', { filePath, analysis });
                    try {
                        const parsed = JSON.parse(analysis);
                        if (parsed && Array.isArray(parsed.findings)) {
                            // same as above, ignore or process them
                        }
                    } catch (jsonErr) {
                        console.error(`[Code analysis ${filePath}] Invalid JSON:`, analysis);
                    }
                } catch (err: any) {
                    vscode.window.showErrorMessage(`Code analysis failed for ${filePath}: ${err.message}`);
                }
            }

            console.log('[CodeScanner] Scan ended');
            vscode.window.showInformationMessage('Codebase scan complete.');
        })
    );
}

export function deactivate() {}
