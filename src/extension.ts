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

export function activate(context: vscode.ExtensionContext) {
    const treeDataProvider = new SecurityScanResultsProvider();
    vscode.window.registerTreeDataProvider('securityScanResultsView', treeDataProvider);

    // Command to open an editor to the selected line(s)
    context.subscriptions.push(
        vscode.commands.registerCommand('extension.revealFinding', async (filename: string, lines: number[]) => {
            try {
                const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filename));
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
