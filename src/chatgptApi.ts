import * as vscode from 'vscode';
import axios from 'axios';

export async function analyzeCodeWithChatGPT(code: string, filePath: string): Promise<string> {
    const apiKey = vscode.workspace.getConfiguration().get<string>('codebaseAnalyzer.openAIApiKey');
    if (!apiKey) {
        throw new Error('OpenAI API key is not set. Please set it in the extension settings.');
    }

    const prompt = `You are a security expert. Analyze the following code for security issues, including but not limited to SQL injection, hardcoded secrets, and improper input validation. For each issue, specify the type, a brief description, and the line number if possible. File: ${filePath}\n\n${code}`;

    const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
            model: 'gpt-4',
            messages: [
                { role: 'system', content: 'You are a security expert.' },
                { role: 'user', content: prompt }
            ],
            max_tokens: 700
        },
        {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        }
    );

    const result = response.data.choices?.[0]?.message?.content;
    return result || 'No analysis result returned.';
}

export async function analyzeDependenciesWithChatGPT(dependencies: string[]): Promise<string> {
    const apiKey = vscode.workspace.getConfiguration().get<string>('codebaseAnalyzer.openAIApiKey');
    if (!apiKey) {
        throw new Error('OpenAI API key is not set. Please set it in the extension settings.');
    }

    const prompt = `Analyze the following list of dependencies for known vulnerabilities. List any vulnerabilities found, and provide recommendations if possible:\n\n${dependencies.join('\n')}`;

    const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
            model: 'gpt-4',
            messages: [
                { role: 'system', content: 'You are a security expert.' },
                { role: 'user', content: prompt }
            ],
            max_tokens: 500
        },
        {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        }
    );

    const result = response.data.choices?.[0]?.message?.content;
    return result || 'No analysis result returned.';
}
