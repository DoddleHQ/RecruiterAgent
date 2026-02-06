import { findPotentialJobTitle, extractTextFromAttachment } from "./emailUtils";
import { extractJobApplication } from "./smartExtract";
import { containsKeyword, getAttachment } from "./gmail";

function stripReplyPrefix(subject: string): string {
    if (!subject) return subject;

    const replyPrefixes = [
        /^Re:\s*/i,
        /^Fwd:\s*/i,
        /^FW:\s*/i,
    ];

    let cleanedSubject = subject;
    for (const prefix of replyPrefixes) {
        cleanedSubject = cleanedSubject.replace(prefix, "");
    }

    return cleanedSubject.trim();
}

function validateCategory(jobTitle: string, currentCategory: string) {
    const developerKeywords = [
        "developer", "engineer", "programmer", "backend", "frontend", "full-stack", "fullstack",
        "node", "react", "angular", "vue", "flutter", "python", "java", "javascript",
        "typescript", "go", "rust", "c++", "c#", "php", "laravel", "mobile", "app", "software",
        "devops", "cloud", "aws", "azure", "gcp", "stack", "mern", "mean"
    ];

    const designerKeywords = [
        "designer", "ui/ux", "web design", "frontend", "css", "html", "figma", "sketch", "adobe",
        "creative", "graphic", "motion", "illustrator"
    ];

    const recruiterKeywords = [
        "recruiter", "hr", "talent acquisition", "hiring", "staffing", "human resource"
    ];

    const salesKeywords = [
        "sales", "marketing", "business development", "growth", "business analyst",
        "seo", "content", "copywriter", "social media", "ads"
    ];

    const jobTitleLower = jobTitle.toLowerCase();

    if (developerKeywords.some(kw => jobTitleLower.includes(kw))) {
        return "Developer";
    } else if (designerKeywords.some(kw => jobTitleLower.includes(kw))) {
        return "Web Designer";
    } else if (recruiterKeywords.some(kw => jobTitleLower.includes(kw))) {
        return "Recruiter";
    } else if (salesKeywords.some(kw => jobTitleLower.includes(kw))) {
        return "Sales/Marketing";
    }

    return currentCategory;
}

/**
 * Tiered extraction for job application details:
 * 1. AI-First Extraction (Agent)
 * 2. One-shot Classifiers fallback (Transformers)
 * 3. Regex Fallback
 */
export async function extractJobDetails({
    subject,
    body,
    mastra,
}: {
    subject: string;
    body: string;
    mastra?: any;
}) {
    const cleanedSubject = stripReplyPrefix(subject || "");
    const potentialJobTitle = findPotentialJobTitle({ subject: cleanedSubject, body });

    console.log(`[Extraction] Cleaned subject: "${cleanedSubject}"`);
    console.log(`[Extraction] Potential job title from regex: "${potentialJobTitle}"`);

    // 0. Fast Path: Subject-only extraction for emails with short bodies
    const subjectOnlyTitle = findPotentialJobTitle({
        subject: cleanedSubject,
        body: ""
    });

    if (subjectOnlyTitle && subjectOnlyTitle !== "" && body.trim().length < 50) {
        console.log(`[Extraction] Fast path: using subject-only title "${subjectOnlyTitle}" for short body`);
        return {
            jobTitle: subjectOnlyTitle.slice(0, 50),
            category: validateCategory(subjectOnlyTitle, "unclear"),
            experienceStatus: "unclear",
            currentCTC: "unclear",
            expectedCTC: "unclear",
            workExp: "unclear",
            interviewTime: "unclear",
            location: "unclear",
            agreement: "unclear"
        };
    }

    // 1. AI-First: Try Agent if available
    if (mastra) {
        try {
            const agent = mastra.getAgent("extractionAgent");
            const result = await agent.generate(
                "Extract job application details from emails with varying structures",
                {
                    instructions: `
You are a job-application parser.  
Analyze this job application email and extract the following information:

EMAIL SUBJECT (cleaned): ${cleanedSubject?.trim()}  
EMAIL BODY: ${body.trim()}  
HINT_TITLE: ${potentialJobTitle ? `'${potentialJobTitle}'` : "None"}

CRITICAL RULES:
1. Search BOTH subject AND body for job title.
2. ONLY extract job title if it EXPLICITLY appears in the subject or body.
3. If no clear job title is mentioned, return "unclear" - DO NOT make up or guess.
4. Clean job title by removing prefixes like "Application for", "Resume for", "Job for", and trailing noise like "Position", "Role", "at Company".
5. Fallback: if no match → use HINT_TITLE if it appears verbatim in body or subject. 

Return ONLY valid JSON in this exact format:
{ 
  "job_title": "the extracted job title", 
  "experience_status": "one of: experienced, fresher, or unclear", 
  "category": "one of: Developer, Web Designer, Recruiter, Sales/Marketing, or unclear",
  "currentCTC": "string or unclear",
  "expectedCTC": "string or unclear",
  "workExp": "string or unclear",
  "interviewTime": "string or unclear",
  "location": "string or unclear",
  "agreement": "string or unclear",
  "confidence": 0.0 to 1.0,
  "reasoning": "brief explanation of your extraction"
} 

CATEGORY CLASSIFICATION RULES:
1. Analyze the extracted job_title to determine the correct category.
2. Use the following mapping:
   - Contains: developer, engineer, programmer, backend, frontend, full-stack, node, react, python, flutter, devops, etc. → "Developer"
   - Contains: designer, ui/ux, web design, figma, creative → "Web Designer"
   - Contains: recruiter, hr, talent acquisition, hiring → "Recruiter"
   - Contains: sales, marketing, business development, growth, seo → "Sales/Marketing"
   - Otherwise → "unclear"

Return **only** the JSON object—no explanation. 
`,
                    maxSteps: 10,
                }
            );

            const jsonMatch = result.text.match(/\{[\s\S]*?\}/);
            if (jsonMatch) {
                try {
                    const cleaned = jsonMatch[0]
                        .replace(/,\s*}/g, '}')
                        .replace(/,\s*]/g, ']');
                    const parsed = JSON.parse(cleaned);

                    if (parsed.job_title && parsed.job_title !== "unclear") {
                        const jobTitle = parsed.job_title.trim();
                        const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, "");
                        const normalizedFullText = normalize(`${cleanedSubject} ${body}`);

                        const titleExists = normalizedFullText.includes(normalize(jobTitle)) ||
                            (jobTitle.includes("/") && jobTitle.split("/").every((part: string) => normalizedFullText.includes(normalize(part)))) ||
                            (jobTitle.includes("&") && jobTitle.split("&").every((part: string) => normalizedFullText.includes(normalize(part))));

                        const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0;
                        console.log(`[Extraction] Agent output title: "${jobTitle}", Confidence: ${confidence}, Exists: ${titleExists}`);

                        // Relax confidence requirement if title exists verbatim in source
                        const minimumConfidence = titleExists ? 0.1 : 0.7;

                        if (titleExists && confidence >= minimumConfidence) {
                            return {
                                jobTitle: jobTitle.slice(0, 50),
                                category: validateCategory(jobTitle, parsed.category || "unclear"),
                                experienceStatus: parsed.experience_status || "unclear",
                                currentCTC: parsed.currentCTC || "unclear",
                                expectedCTC: parsed.expectedCTC || "unclear",
                                workExp: parsed.workExp || "unclear",
                                interviewTime: parsed.interviewTime || "unclear",
                                location: parsed.location || "unclear",
                                agreement: parsed.agreement || "unclear"
                            };
                        } else {
                            const fullText = `${subject} ${body}`;
                            const sourcePreview = fullText.slice(0, 500).replace(/\n/g, " ");
                            if (!titleExists) {
                                console.warn(`[Extraction] Hallucination detected: "${jobTitle}" not found verbatim in source. Source preview: "${sourcePreview}..."`);
                            } else {
                                console.warn(`[Extraction] Low confidence (${confidence}) for: "${jobTitle}". Source preview: "${sourcePreview}..."`);
                            }
                            // Don't return here, let it fall back to other methods
                        }
                    } else {
                        console.log(`[Extraction] Agent returned "unclear" or missing title. Reasoning: ${parsed.reasoning || 'N/A'}`);
                    }
                } catch (e) {
                    console.error("Error parsing agent JSON result:", e);
                }
            }
        } catch (err) {
            console.error("Agent extraction failed:", err);
        }
    }

    // 2. Fallback to One-shot Classifiers (Transformers)
    try {
        const extraction = await extractJobApplication(cleanedSubject, body);

        if (extraction.jobTitle !== "unclear") {
            const jobTitle = extraction.jobTitle.trim();
            const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, "");
            const normalizedFullText = normalize(`${cleanedSubject} ${body}`);

            const titleExists = normalizedFullText.includes(normalize(jobTitle)) ||
                (jobTitle.includes("/") && jobTitle.split("/").every((part: string) => normalizedFullText.includes(normalize(part)))) ||
                (jobTitle.includes("&") && jobTitle.split("&").every((part: string) => normalizedFullText.includes(normalize(part))));

            // For SmartExtract, we still want a verbatim check to avoid hallucinations
            if (titleExists) {
                return {
                    jobTitle: jobTitle.slice(0, 50),
                    category: validateCategory(jobTitle, extraction.category),
                    experienceStatus: extraction.experienceStatus,
                    currentCTC: "unclear",
                    expectedCTC: "unclear",
                    workExp: "unclear",
                    interviewTime: "unclear",
                    location: "unclear",
                    agreement: "unclear"
                };
            }
        }
    } catch (err) {
        console.error("SmartExtract failed:", err);
    }

    // 3. Ultimate Fallback
    if (potentialJobTitle && potentialJobTitle !== "") {
        console.log(`[Extraction] Ultimate fallback: using regex title "${potentialJobTitle}"`);
        return {
            jobTitle: potentialJobTitle.slice(0, 50),
            category: validateCategory(potentialJobTitle, "unclear"),
            experienceStatus: "unclear",
            currentCTC: "unclear",
            expectedCTC: "unclear",
            workExp: "unclear",
            interviewTime: "unclear",
            location: "unclear",
            agreement: "unclear"
        };
    }

    console.warn(`[Extraction] All methods failed to extract job title.`);
    return {
        jobTitle: "unclear",
        category: "unclear",
        experienceStatus: "unclear",
        currentCTC: "unclear",
        expectedCTC: "unclear",
        workExp: "unclear",
        interviewTime: "unclear",
        location: "unclear",
        agreement: "unclear"
    };
}

export async function detectResumeStatus({
    body,
    attachmentFilenames,
    attachmentIds,
    messageId,
    messageIds,
    resumeLink,
}: {
    body: string;
    attachmentFilenames: string[];
    attachmentIds?: string[];
    messageId?: string;
    messageIds?: string[];
    resumeLink?: string | null;
}) {
    // Layer 0: explicit Link (Indeed style)
    if (resumeLink) return true;

    // Layer 1: Fast Keyword Check (High Confidence)
    const hasResumeKeywordsInFilenames = attachmentFilenames.some(filename =>
        containsKeyword({
            text: filename || "",
            keywords: ["resume", "cv", "curriculum vitae", "profile", "application", "bio", "portfolio"],
        })
    );

    if (hasResumeKeywordsInFilenames) return true;

    // Layer 2: Check Body references (High Confidence)
    const hasResumeMentionInBody = containsKeyword({
        text: body || "",
        keywords: [
            "resume attached",
            "cv attached",
            "please find my resume",
            "attached is my resume",
            "attached my resume",
            "find attached resume",
            "find attached cv",
            "resume is attached",
            "cv is attached",
            "attached resume",
            "attached cv",
        ],
    });

    if (hasResumeMentionInBody) return true;

    // Layer 3: Content-based check for files with PDF/DOCX extensions (High Confidence)
    if (attachmentIds && attachmentFilenames.length > 0 && (messageId || messageIds)) {
        const files = attachmentFilenames.map((f, i) => ({
            filename: f,
            id: attachmentIds[i],
            msgId: (messageIds && messageIds[i]) ? messageIds[i] : messageId
        }));

        const docFiles = files.filter(f => /\.(pdf|docx|doc)$/i.test(f.filename));

        for (const file of docFiles) {
            try {
                if (!file.id || !file.msgId) continue;
                const attachmentData = await getAttachment(file.msgId, file.id);
                if (attachmentData.data) {
                    const text = await extractTextFromAttachment({
                        filename: file.filename,
                        attachment: attachmentData.data
                    });

                    // Comprehensive resume indicators
                    const resumeIndicators = [
                        "experience", "work history", "education", "skills",
                        "projects", "summary", "objective", "contact",
                        "achievements", "certifications", "technical skills",
                        "professional profile", "employment", "academic",
                        "qualification", "university", "college", "degree",
                        "github", "linkedin", "portfolio", "technologies"
                    ];

                    const textLower = text.toLowerCase();
                    const matches = resumeIndicators.filter(indicator =>
                        textLower.includes(indicator)
                    ).length;

                    // If we find 4 or more indicators, or high-density keywords, it's a resume
                    if (matches >= 4 || (textLower.includes("curriculum vitae") || textLower.includes("resume"))) return true;
                }
            } catch (err) {
                console.error(`[ResumeDetection] Error checking attachment content for ${file.filename}:`, err);
            }
        }
    }

    // Layer 4: Minimal keyword check in body (Low Confidence)
    return containsKeyword({
        text: body || "",
        keywords: ["resume", "cv", "curriculum vitae"],
    });
}

export function detectCoverLetterStatus({
    body,
    attachmentFilenames,
}: {
    body: string;
    attachmentFilenames: string[];
}) {
    const aiGeneratedKeywords = [
        "[job title]", "[company name]", "[candidate name]", "[position]", "[category]",
        "[experience status]", "[job description]", "[responsibilities]", "[skills]",
        "[qualifications]", "[salary range]", "[location]", "[industry]", "[job type]",
        "[company size]", "[company website]", "[company email]", "[company phone]",
        "[company address]", "[hiring manager name]", "[hiring manager email]",
        "[hiring manager phone]", "[hiring manager title]", "[recruiter name]",
        "[recruiter email]", "[recruiter phone]", "[recruiter title]",
        "[company founders]", "[company founded date]", "[company mission]",
        "[company values]", "[company culture]", "[company benefits]", "[company perks]",
        "[company awards]", "[company recognition]", "[company news]", "[company events]",
        "[company social media]", "[company career page]", "[company about page]",
        "[company contact page]", "[company team page]", "[company leadershipblog page]",
        "[company jobs page]", "[company press page]", "[company investor page]",
        "[company faq page]", "[company help page]", "[company privacy page]",
        "[company terms page]", "[company disclaimer page]", "[company accessibility page]",
        "[company sitemap page]", "[company robots page]", "[company humans page]",
        "[company security page]", "[company cookie page]", "[company legal page]",
        "[company copyright page]", "[company trademark page]",
    ];

    const aiGeneratedMatches = aiGeneratedKeywords.filter(keyword =>
        body.toLowerCase().includes(keyword.toLowerCase())
    );

    if (aiGeneratedMatches.length > 2) {
        return false;
    }

    const hasCoverLetterAttachment = attachmentFilenames.some(filename =>
        containsKeyword({
            text: filename || "",
            keywords: ["cover letter", "coverletter", "application letter", "motivation letter"],
        })
    );

    const hasCoverLetterInBody = containsKeyword({
        text: body,
        keywords: [
            "cover letter", "dear hiring manager", "dear sir or madam", "dear team",
            "dear recruiter", "dear [company]", "i am writing to", "i am excited to apply",
            "i am reaching out", "i am interested in", "thank you for considering",
            "thank you for your time", "sincerely yours", "best regards",
            "/with \\d+ years of experience/i", "with hands-on experience in",
            "i bring to the table", "i offer", "i am eager to", "i am passionate about",
            "i am confident that", "i would love the opportunity", "i am looking forward to",
            "contribute to your team", "add value to your organization",
            "aligns with my career goals", "proficient in", "expertise in", "skilled at",
            "experience working with", "experience includes", "hands-on knowledge of",
            "demonstrated ability in", "proven track record", "strong background in",
            "solid understanding of", "improved", "increased", "reduced", "achieved",
            "delivered", "optimized", "enhanced", "streamlined", "boosted", "spearheaded",
            "led the development", "successfully launched", "production-ready apps",
            "real-world projects", "team-oriented", "detail-oriented", "self-motivated",
            "fast learner", "adaptable", "collaborative", "multitask", "problem-solving",
            "critical thinking", "communication skills", "your company’s mission",
            "your innovative projects", "your dynamic environment", "your development team",
            "your engineering culture", "your product roadmap", "your commitment to excellence",
        ],
    }) &&
        body.length >= 100 &&
        body.trim().split(/\s+/).length >= 20;

    return hasCoverLetterAttachment || hasCoverLetterInBody;
}
