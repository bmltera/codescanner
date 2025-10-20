// Corrected TypeScript code with a two-level TreeView (Start Scan item + vulnerabilities at top level, details as children):

import * as vscode from 'vscode';
import { findDependencyFiles, parseRequirementsTxt, parsePackageJson } from './dependencyScanner';
import { findSourceCodeFiles, readCodeFile } from './codeScanner';
import { analyzeDependenciesWithChatGPT, analyzeCodeWithChatGPT } from './chatgptApi';

// --- TreeView with Start Scan button, scanning spinner, and multi-level items
class SecurityScanResultsProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | void> = new vscode.EventEmitter();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | void> = this._onDidChangeTreeData.event;

    private scanning: boolean = false;
    private findings: any[] = [];
    private treeItemCounter: number = 0;

    // Trigger a refresh
    refresh() {
        this._onDidChangeTreeData.fire();
    }

    setScanning(scanning: boolean) {
        this.scanning = scanning;
        this.refresh();
    }

    // Overwrite existing findings array
    setFindings(findings: any[]) {
        this.findings = findings;
        this.refresh();
    }

    // Add new findings, deduplicating by filename+lines+vulnerability
    addFindings(newFindings: any[]) {
        const key = (f: any) => `${f.filename}|${(f.lines_affected ?? []).join(',')}|${f.vulnerability}`;
        const existingKeys = new Set(this.findings.map(key));
        const deduped = newFindings.filter((f: any) => !existingKeys.has(key(f)));
        this.findings.push(...deduped);
        this.refresh();
    }

    // Clear all findings and reset the item counter
    clearFindings() {
        this.findings = [];
        this.treeItemCounter = 0;
        this.refresh();
    }

    // Called to get a TreeItem representation of the given element
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    // Called to get children for a given element. If no element is passed, we are at the root
    getChildren(element?: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem[]> {
        if (this.scanning) {
            // Show spinner if scanning
            return [
                new vscode.TreeItem('$(sync~spin) Scanning for vulnerabilities...')
            ];
        }

        // If no element, show the "Start Scan" item + top-level vulnerabilities
        if (!element) {
            const startScanItem = new vscode.TreeItem('Start Scan');
            startScanItem.command = {
                command: 'extension.startScan',
                title: 'Start Scan'
            };
            startScanItem.iconPath = new vscode.ThemeIcon('play-circle');

            const topLevelVulnerabilityItems = this.findings.map((f) => {
                const label = `${f.vulnerability} (${f.risk_score})`;
                const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed);

                // Icon depends on risk score
                item.iconPath = new vscode.ThemeIcon(
                    f.risk_score === 'high' ? 'error' :
                    f.risk_score === 'medium' ? 'warning' : 'info'
                );

                // Use a session-unique counter for the item ID
                item.id = `finding-${this.treeItemCounter++}`;

                // Save full data in the item for child usage
                (item as any).vulnerabilityData = f;

                return item;
            });

            return [startScanItem, ...topLevelVulnerabilityItems];
        } else {
            // If we have an element, it's a vulnerability item => show details as children
            const f = (element as any).vulnerabilityData;
            if (!f) {
                return [];
            }

            const children: vscode.TreeItem[] = [];

            // lines child
            const linesItem = new vscode.TreeItem(`Lines: ${f.lines_affected?.join(', ')}`, vscode.TreeItemCollapsibleState.None);
            linesItem.tooltip = `Affected lines: ${f.lines_affected?.join(', ')}`;
            linesItem.iconPath = new vscode.ThemeIcon('list-selection');
            children.push(linesItem);

            // explanation child
            const explanationItem = new vscode.TreeItem('Explanation', vscode.TreeItemCollapsibleState.None);
            explanationItem.description = f.explanation;
            explanationItem.tooltip = f.explanation;
            explanationItem.iconPath = new vscode.ThemeIcon('info');
            children.push(explanationItem);

            // recommendation child
            const recommendationItem = new vscode.TreeItem('Recommendation', vscode.TreeItemCollapsibleState.None);
            recommendationItem.description = f.recommendation;
            recommendationItem.tooltip = f.recommendation;
            recommendationItem.iconPath = new vscode.ThemeIcon('lightbulb');
            children.push(recommendationItem);

            // "Open File" child
            const openFileItem = new vscode.TreeItem('Open File', vscode.TreeItemCollapsibleState.None);
            openFileItem.iconPath = new vscode.ThemeIcon('go-to-file');
            openFileItem.command = {
                command: 'extension.revealFinding',
                title: 'Reveal Finding',
                arguments: [f.filename, f.lines_affected],
            };
            children.push(openFileItem);

            return children;
        }
    }
}

class SecurityScanWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'securityScanWebview';
    private _view?: vscode.WebviewView;
    private _latestFindings: any[] = [];

    constructor(private readonly _extensionUri: vscode.Uri, private readonly _context: vscode.ExtensionContext) {}

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };
        webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

        // Restore findings if available
        if (this._latestFindings && this._latestFindings.length > 0) {
            this.setFindings(this._latestFindings);
        } else {
            // Try to restore from globalState (Memento)
            const saved = this._context.globalState.get<any[]>("securityScanFindings");
            if (saved && Array.isArray(saved) && saved.length > 0) {
                this._latestFindings = saved;
                this.setFindings(saved);
            }
        }
        // Hydrate full UI state from globalState (for VS Code restarts)
        const fullState = this._context.globalState.get<any>("securityAnalyzer:data");
        if (fullState) {
            webviewView.webview.postMessage({ type: "hydrate", state: fullState });
        }

        // Listen for messages from the webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
            if (message.command === 'startScan') {
                this.setScanning(true);
                const findings = await runSecurityScan();
                this.setScanning(false);
                this.setFindings(findings);
            } else if (message.command === 'openFile' && message.filename && message.lines) {
                vscode.commands.executeCommand('extension.revealFinding', message.filename, message.lines);
            }
        });
    }

    private setScanning(scanning: boolean) {
        if (this._view) {
            this._view.webview.postMessage({ type: 'scanning', scanning });
            // Save full UI state (scanning + findings) to globalState for VS Code restarts
            this.saveFullState(scanning, this._latestFindings);
        }
    }

    private setFindings(findings: any[]) {
        this._latestFindings = findings;
        // Save to globalState for persistence
        this._context.globalState.update("securityScanFindings", findings);
        if (this._view) {
            this._view.webview.postMessage({ type: 'findings', findings });
            // Save full UI state (scanning + findings) to globalState for VS Code restarts
            this.saveFullState(false, findings);
        }
    }

    private saveFullState(scanning: boolean, findings: any[]) {
        const state = { scanning, findings };
        this._context.globalState.update("securityAnalyzer:data", state);
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        // UI: Start Scan button, spinner, findings list, with state persistence
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    body { font-family: var(--vscode-font-family); margin: 0; padding: 0.5em; }
                    button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 0.5em 1em; border-radius: 3px; cursor: pointer; }
                    button:hover { background: var(--vscode-button-hoverBackground); }
                    #findings { margin-top: 1em; }
                    .spinner { display: inline-block; width: 20px; height: 20px; border: 3px solid var(--vscode-editorWidget-border); border-top: 3px solid var(--vscode-button-background); border-radius: 50%; animation: spin 1s linear infinite; vertical-align: middle; }
                    @keyframes spin { 100% { transform: rotate(360deg); } }
                    .finding { border: 1px solid var(--vscode-editorWidget-border); border-radius: 4px; margin-bottom: 0.5em; padding: 0.5em; }
                    .risk-high { color: var(--vscode-errorForeground); }
                    .risk-medium { color: var(--vscode-editorWarning-foreground); }
                    .risk-low { color: var(--vscode-editorInfo-foreground); }
                    .details { margin-left: 1em; font-size: 0.95em; }
                    .open-file-btn { margin-top: 0.5em; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
                </style>
            </head>
            <body>
                <button id="startScan">Start Scan</button>
                <span id="spinner" style="display:none;" class="spinner"></span>
                <div id="findings">No scan results yet.</div>
                <script>
                    const vscode = acquireVsCodeApi();
                    const startBtn = document.getElementById('startScan');
                    const findingsDiv = document.getElementById('findings');
                    const spinner = document.getElementById('spinner');

                    // --- State persistence helpers
                    function getUIState() {
                        return {
                            scanning: spinner.style.display === 'inline-block',
                            findings: window._currentFindings || []
                        };
                    }
                    function restoreUI(state) {
                        if (!state) return;
                        // Restore spinner
                        if (state.scanning) {
                            spinner.style.display = 'inline-block';
                            findingsDiv.textContent = 'Scanning for vulnerabilities...';
                            startBtn.disabled = true;
                        } else {
                            spinner.style.display = 'none';
                            startBtn.disabled = false;
                        }
                        // Restore findings
                        window._currentFindings = state.findings || [];
                        renderFindings(window._currentFindings);
                    }
                    function persist() {
                        vscode.setState(getUIState());
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
                            const riskClass = f.risk_score === 'high' ? 'risk-high' : (f.risk_score === 'medium' ? 'risk-medium' : 'risk-low');
                            const el = document.createElement('div');
                            el.className = 'finding';
                            el.innerHTML = \`
                                <b class="\${riskClass}">\${f.vulnerability} (<span>\${f.risk_score}</span>)</b>
                                <div class="details">
                                    <div><b>File:</b> \${f.filename}</div>
                                    <div><b>\${(f.lines_affected && f.lines_affected.length === 1) ? "Affected line:" : "Affected lines:"}</b> \${(f.lines_affected || []).join(', ')}</div>
                                    <div><b>Explanation:</b> \${f.explanation}</div>
                                    <div><b>Recommendation:</b> \${f.recommendation}</div>
                                    <button class="open-file-btn">Open File</button>
                                </div>
                            \`;
                            el.querySelector('.open-file-btn').addEventListener('click', () => {
                                vscode.postMessage({ command: 'openFile', filename: f.filename, lines: f.lines_affected });
                            });
                            findingsDiv.appendChild(el);
                        });
                        persist();
                    }

                    // --- Restore state on load
                    const saved = vscode.getState && vscode.getState();
                    if (saved) {
                        restoreUI(saved);
                    }

                    startBtn.addEventListener('click', () => {
                        spinner.style.display = 'inline-block';
                        findingsDiv.textContent = 'Scanning for vulnerabilities...';
                        startBtn.disabled = true;
                        persist();
                        vscode.postMessage({ command: 'startScan' });
                    });

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
                </script>
            </body>
            </html>
        `;
    }
}

async function runSecurityScan(): Promise<any[]> {
    // This function runs the same scan logic as the TreeView, but returns findings for the webview
    let findings: any[] = [];
    // 1. Dependencies
    const depFiles = await findDependencyFiles();
    let allDependencies: string[] = [];
    for (const file of depFiles) {
        if (file.endsWith('requirements.txt')) {
            const deps = parseRequirementsTxt(file).map(d => `${d.name}${d.version ? d.version : ''}`);
            allDependencies.push(...deps);
        } else if (file.endsWith('package.json')) {
            const deps = parsePackageJson(file).map(d => `${d.name}@${d.version}`);
            allDependencies.push(...deps);
        }
    }
    if (allDependencies.length > 0) {
        try {
            const depAnalysis = await analyzeDependenciesWithChatGPT(allDependencies);
            let depFindings = [];
            try {
                const parsed = JSON.parse(depAnalysis);
                if (parsed && Array.isArray(parsed.findings)) {
                    depFindings = parsed.findings;
                    findings.push(...depFindings);
                }
            } catch (jsonErr) {
                console.error('Dependency analysis: Invalid JSON', depAnalysis);
            }
        } catch (err: any) {
            vscode.window.showErrorMessage('Dependency analysis failed: ' + err.message);
        }
    }

    // 2. Code files
    const codeFiles = await findSourceCodeFiles();
    for (const filePath of codeFiles) {
        try {
            const codeFile = readCodeFile(filePath);
            const analysis = await analyzeCodeWithChatGPT(codeFile.content, filePath);
            let codeFindings = [];
            try {
                const parsed = JSON.parse(analysis);
                if (parsed && Array.isArray(parsed.findings)) {
                    codeFindings = parsed.findings;
                    findings.push(...codeFindings);
                }
            } catch (jsonErr) {
                console.error(`Code analysis (${filePath}): Invalid JSON`, analysis);
            }
        } catch (err: any) {
            vscode.window.showErrorMessage(`Code analysis failed for ${filePath}: ${err.message}`);
        }
    }
    // Convert all finding filenames to relative paths
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
        const root = workspaceFolders[0].uri.fsPath;
        findings.forEach(f => {
            if (f.filename && f.filename.startsWith(root)) {
                let rel = f.filename.substring(root.length);
                if (rel.startsWith("\\") || rel.startsWith("/")) rel = rel.substring(1);
                f.filename = rel;
            }
        });
    }
    return findings;
}

export function activate(context: vscode.ExtensionContext) {
    const treeDataProvider = new SecurityScanResultsProvider();
    vscode.window.registerTreeDataProvider('securityScanResultsView', treeDataProvider);

    // Register the webview provider
    const webviewProvider = new SecurityScanWebviewProvider(context.extensionUri, context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            SecurityScanWebviewProvider.viewType,
            webviewProvider,
            {
                webviewOptions: {
                    retainContextWhenHidden: true
                }
            }
        )
    );

    // Command to open an editor to the selected line(s)
    context.subscriptions.push(
        vscode.commands.registerCommand('extension.revealFinding', async (filename: string, lines: number[]) => {
            try {
                let absPath = filename;
                // If not absolute, resolve relative to workspace root
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
        })
    );

    // (Webview code temporarily removed for debugging "Invalid regular expression" error)

    // The main "Start Scan" command
    context.subscriptions.push(
        vscode.commands.registerCommand('extension.startScan', async () => {
            // (Webview code removed for debugging)

            treeDataProvider.setScanning(true);
            treeDataProvider.clearFindings();
            console.log('[CodeScanner] Scan started');
            const diagnosticsCollection = vscode.languages.createDiagnosticCollection('codebaseAnalyzer');
            diagnosticsCollection.clear();

            // 1. Dependencies
            const depFiles = await findDependencyFiles();
            let allDependencies: string[] = [];
            for (const file of depFiles) {
                if (file.endsWith('requirements.txt')) {
                    const deps = parseRequirementsTxt(file).map(d => `${d.name}${d.version ? d.version : ''}`);
                    allDependencies.push(...deps);
                } else if (file.endsWith('package.json')) {
                    const deps = parsePackageJson(file).map(d => `${d.name}@${d.version}`);
                    allDependencies.push(...deps);
                }
            }
            if (allDependencies.length > 0) {
                try {
                    console.log('[ChatGPT Dependency Prompt]', allDependencies);
                    const depAnalysis = await analyzeDependenciesWithChatGPT(allDependencies);
                    console.log('[ChatGPT Dependency Response]', depAnalysis);
                    let depFindings = [];
                    try {
                        const parsed = JSON.parse(depAnalysis);
                        if (parsed && Array.isArray(parsed.findings)) {
                            depFindings = parsed.findings;
                            // (Webview update removed for debugging)
                            treeDataProvider.addFindings(depFindings);
                        }
                    } catch (jsonErr) {
                        // (Webview update removed for debugging)
                        console.error('Dependency analysis: Invalid JSON', depAnalysis);
                    }
                    vscode.window.showInformationMessage('Dependency analysis complete. See output for details.');
                    const depOutput = vscode.window.createOutputChannel('Dependency Analysis');
                    depOutput.appendLine(depAnalysis);
                    depOutput.show();
                } catch (err: any) {
                    vscode.window.showErrorMessage('Dependency analysis failed: ' + err.message);
                }
            }

            // 2. Code files
            const codeFiles = await findSourceCodeFiles();
            for (const filePath of codeFiles) {
                try {
                    const codeFile = readCodeFile(filePath);
                    console.log('[ChatGPT Code Prompt]', { filePath, content: codeFile.content });
                    const analysis = await analyzeCodeWithChatGPT(codeFile.content, filePath);
                    console.log('[ChatGPT Code Response]', { filePath, analysis });

                    // Parse JSON findings
                    let codeFindings = [];
                    try {
                        const parsed = JSON.parse(analysis);
                        if (parsed && Array.isArray(parsed.findings)) {
                            codeFindings = parsed.findings;
                            // (Webview update removed for debugging)
                            treeDataProvider.addFindings(codeFindings);
                        }
                    } catch (jsonErr) {
                        // (Webview update removed for debugging)
                        console.error(`Code analysis (${filePath}): Invalid JSON`, analysis);
                    }

                    // Legacy textual parse for line-based diagnostics
                    const diagnostics: vscode.Diagnostic[] = [];
                    const issueRegex = /Type:\s*(.+?)\s*Description:\s*(.+?)\s*Line:\s*(\d+)/gi;
                    let match;
                    while ((match = issueRegex.exec(analysis)) !== null) {
                        const [, type, description, lineStr] = match;
                        const line = parseInt(lineStr, 10) - 1;
                        const range = new vscode.Range(line, 0, line, 100);
                        diagnostics.push(new vscode.Diagnostic(
                            range,
                            `[${type.trim()}] ${description.trim()}`,
                            vscode.DiagnosticSeverity.Warning
                        ));
                    }
                    if (diagnostics.length > 0) {
                        diagnosticsCollection.set(vscode.Uri.file(filePath), diagnostics);
                    }

                } catch (err: any) {
                    vscode.window.showErrorMessage(`Code analysis failed for ${filePath}: ${err.message}`);
                }
            }

            treeDataProvider.setScanning(false);
            console.log('[CodeScanner] Scan ended');
            vscode.window.showInformationMessage('Codebase scan complete.');
        })
    );
}

export function deactivate() {}
