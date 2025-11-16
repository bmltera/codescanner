import * as vscode from 'vscode';
import axios from 'axios';

export async function analyzeCodeWithChatGPT(code: string, filePath: string): Promise<string> {
    const apiKey = vscode.workspace.getConfiguration().get<string>('codebaseAnalyzer.openAIApiKey');
    if (!apiKey) {
        throw new Error('OpenAI API key is not set. Please set it in the extension settings.');
    }

    const prompt = `You are a security expert. Analyze the following code for security vulnerabilities and risks.

You MUST classify each finding using ONE of the predefined vulnerability types below. 
For each finding, you MUST:
- use the vulnerability name EXACTLY as written
- use the default risk_score shown here
- copy the corresponding reference URL into the "reference" field
- NOT invent new vulnerability names or reference URLs

High-risk vulnerabilities (risk_score: "high"):
1. SQL Injection — reference: https://owasp.org/www-community/attacks/SQL_Injection
2. Command Injection — reference: https://owasp.org/www-community/attacks/Command_Injection
3. Insecure Deserialization — reference: https://owasp.org/www-community/vulnerabilities/Deserialization_of_untrusted_data
4. Hardcoded Secret — reference: https://owasp.org/www-community/vulnerabilities/Use_of_hard-coded_password
5. Broken Authentication — reference: https://owasp.org/Top10/A07_2021-Identification_and_Authentication_Failures/
6. Broken Access Control — reference: https://owasp.org/Top10/A01_2021-Broken_Access_Control/
7. Server-Side Request Forgery (SSRF) — reference: https://owasp.org/www-community/attacks/Server_Side_Request_Forgery
8. XML External Entity (XXE) Injection — reference: https://owasp.org/www-community/vulnerabilities/XML_External_Entity_(XXE)_Processing
9. Path Traversal — reference: https://owasp.org/www-community/attacks/Path_Traversal
10. Insecure Direct Object Reference (IDOR) — reference: https://owasp.org/www-community/attacks/Direct_Object_References

Medium-risk vulnerabilities (risk_score: "medium"):
11. Cross-Site Scripting (XSS) — reference: https://owasp.org/www-community/attacks/xss/
12. Cross-Site Request Forgery (CSRF) — reference: https://owasp.org/www-community/attacks/csrf
13. Sensitive Data Exposure / Cryptographic Failures — reference: https://owasp.org/Top10/A02_2021-Cryptographic_Failures/
14. Insecure File Upload — reference: https://owasp.org/www-community/vulnerabilities/Unrestricted_File_Upload
15. Insecure Randomness — reference: https://owasp.org/www-community/vulnerabilities/Use_of_insufficiently_random_values
16. Insecure Cookie Settings — reference: https://owasp.org/www-project-cheat-sheets/cheatsheets/Session_Management_Cheat_Sheet.html
17. Missing Rate Limiting / Brute Force Protection — reference: https://owasp.org/www-community/controls/Blocking_Brute_Force_Attacks
18. Security Misconfiguration — reference: https://owasp.org/Top10/A05_2021-Security_Misconfiguration/
19. Use of Vulnerable or Outdated Components — reference: https://owasp.org/Top10/A06_2021-Vulnerable_and_Outdated_Components/
20. Insufficient Logging & Monitoring — reference: https://owasp.org/www-project-top-ten/2017/A10_2017-Insufficient_Logging&Monitoring

Low-risk vulnerabilities (risk_score: "low"):
21. Information Disclosure via Error Messages — reference: https://owasp.org/www-community/Improper_Error_Handling
22. Insecure Logging (Sensitive Data in Logs) — reference: https://owasp.org/www-project-cheat-sheets/cheatsheets/Logging_Cheat_Sheet.html
23. Missing Security Headers — reference: https://owasp.org/www-project-secure-headers/
24. Use of HTTP Instead of HTTPS — reference: https://owasp.org/www-project-cheat-sheets/cheatsheets/Transport_Layer_Protection_Cheat_Sheet.html
25. Weak Password Policy — reference: https://owasp.org/www-community/controls/Authentication_Cheat_Sheet

If the code does not clearly match any of these categories, do NOT create a finding for it.

Return ONLY valid JSON in the following format:

{
  "findings": [
    {
      "vulnerability": "SQL Injection",
      "risk_score": "high",
      "filename": "server/routes/user.js",
      "lines_affected": [42, 47],
      "explanation": "User input is concatenated directly into an SQL query without parameterization.",
      "recommendation": "Use prepared statements or ORM query builders to prevent injection attacks.",
      "reference": "https://owasp.org/www-community/attacks/SQL_Injection"
    }
  ]
}

Each finding must include:
- vulnerability: EXACTLY one of the names from the list above
- risk_score: "low", "medium", or "high" (use the default for that vulnerability type)
- filename: the relative path of the file (use: ${filePath})
- lines_affected: array of affected line numbers
- explanation: brief summary of why this is a vulnerability or risk
- recommendation: concise, actionable mitigation advice
- reference: the URL associated with the chosen vulnerability type (copied exactly from the list above)

If there are no findings, return {"findings": []}

Analyze this file: ${filePath}

${code}
`;

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

    const prompt = `You are a security expert. Analyze the following list of dependencies for known or likely security vulnerabilities.

You MUST classify each dependency-related finding using ONE of the same predefined vulnerability types below, when applicable (especially "Use of Vulnerable or Outdated Components"). 
For each finding, you MUST:
- use the vulnerability name EXACTLY as written
- use the default risk_score shown here
- copy the corresponding reference URL into the "reference" field
- NOT invent new vulnerability names or reference URLs

High-risk vulnerabilities (risk_score: "high"):
1. SQL Injection — reference: https://owasp.org/www-community/attacks/SQL_Injection
2. Command Injection — reference: https://owasp.org/www-community/attacks/Command_Injection
3. Insecure Deserialization — reference: https://owasp.org/www-community/vulnerabilities/Deserialization_of_untrusted_data
4. Hardcoded Secret — reference: https://owasp.org/www-community/vulnerabilities/Use_of_hard-coded_password
5. Broken Authentication — reference: https://owasp.org/Top10/A07_2021-Identification_and_Authentication_Failures/
6. Broken Access Control — reference: https://owasp.org/Top10/A01_2021-Broken_Access_Control/
7. Server-Side Request Forgery (SSRF) — reference: https://owasp.org/www-community/attacks/Server_Side_Request_Forgery
8. XML External Entity (XXE) Injection — reference: https://owasp.org/www-community/vulnerabilities/XML_External_Entity_(XXE)_Processing
9. Path Traversal — reference: https://owasp.org/www-community/attacks/Path_Traversal
10. Insecure Direct Object Reference (IDOR) — reference: https://owasp.org/www-community/attacks/Direct_Object_References

Medium-risk vulnerabilities (risk_score: "medium"):
11. Cross-Site Scripting (XSS) — reference: https://owasp.org/www-community/attacks/xss/
12. Cross-Site Request Forgery (CSRF) — reference: https://owasp.org/www-community/attacks/csrf
13. Sensitive Data Exposure / Cryptographic Failures — reference: https://owasp.org/Top10/A02_2021-Cryptographic_Failures/
14. Insecure File Upload — reference: https://owasp.org/www-community/vulnerabilities/Unrestricted_File_Upload
15. Insecure Randomness — reference: https://owasp.org/www-community/vulnerabilities/Use_of_insufficiently_random_values
16. Insecure Cookie Settings — reference: https://owasp.org/www-project-cheat-sheets/cheatsheets/Session_Management_Cheat_Sheet.html
17. Missing Rate Limiting / Brute Force Protection — reference: https://owasp.org/www-community/controls/Blocking_Brute_Force_Attacks
18. Security Misconfiguration — reference: https://owasp.org/Top10/A05_2021-Security_Misconfiguration/
19. Use of Vulnerable or Outdated Components — reference: https://owasp.org/Top10/A06_2021-Vulnerable_and_Outdated_Components/
20. Insufficient Logging & Monitoring — reference: https://owasp.org/www-project-top-ten/2017/A10_2017-Insufficient_Logging&Monitoring

Low-risk vulnerabilities (risk_score: "low"):
21. Information Disclosure via Error Messages — reference: https://owasp.org/www-community/Improper_Error_Handling
22. Insecure Logging (Sensitive Data in Logs) — reference: https://owasp.org/www-project-cheat-sheets/cheatsheets/Logging_Cheat_Sheet.html
23. Missing Security Headers — reference: https://owasp.org/www-project-secure-headers/
24. Use of HTTP Instead of HTTPS — reference: https://owasp.org/www-project-cheat-sheets/cheatsheets/Transport_Layer_Protection_Cheat_Sheet.html
25. Weak Password Policy — reference: https://owasp.org/www-community/controls/Authentication_Cheat_Sheet

For dependency analysis, the most common category will be "Use of Vulnerable or Outdated Components", but others may apply if the dependency is known to be linked to those issues.

Return ONLY valid JSON in the following format:

{
  "findings": [
    {
      "vulnerability": "Use of Vulnerable or Outdated Components",
      "risk_score": "medium",
      "filename": "requirements.txt",
      "lines_affected": [],
      "explanation": "This dependency version has known vulnerabilities or is significantly outdated.",
      "recommendation": "Upgrade to a secure, supported version or replace with a safer alternative.",
      "reference": "https://owasp.org/Top10/A06_2021-Vulnerable_and_Outdated_Components/"
    }
  ]
}

Each finding must include:
- vulnerability: the name/type (EXACTLY one of the names from the list above)
- risk_score: "low", "medium", or "high" (use the default for that vulnerability type)
- filename: the dependency file (e.g. requirements.txt, package.json)
- lines_affected: [] (empty array or N/A for dependencies)
- explanation: brief summary of why this is a vulnerability or risk
- recommendation: concise, actionable mitigation advice
- reference: the URL associated with the chosen vulnerability type (copied exactly from the list above)

If there are no findings, return {"findings": []}

Analyze these dependencies (one finding per vulnerability):

${dependencies.join('\n')}
`;

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
