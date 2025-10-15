import * as vscode from 'vscode';
import * as fs from 'fs';

export interface CodeFile {
    path: string;
    language: string;
    content: string;
}

const SUPPORTED_EXTENSIONS = [
    '.py', '.js', '.ts', '.jsx', '.tsx', '.java', '.c', '.cpp', '.cs', '.go', '.rb', '.php'
];

export async function findSourceCodeFiles(): Promise<string[]> {
    const patterns = SUPPORTED_EXTENSIONS.map(ext => `**/*${ext}`);
    const files: vscode.Uri[] = [];
    for (const pattern of patterns) {
        const found = await vscode.workspace.findFiles(pattern, '**/node_modules/**');
        files.push(...found);
    }
    return files.map(f => f.fsPath);
}

export function readCodeFile(filePath: string): CodeFile {
    const ext = filePath.substring(filePath.lastIndexOf('.'));
    const language = ext.replace('.', '');
    const content = fs.readFileSync(filePath, 'utf-8');
    return { path: filePath, language, content };
}
