import { pipeline } from '@xenova/transformers';

let classifier: any;
let extractor: any;
let initPromise: Promise<void> | null = null;

async function initModels() {
    if (classifier && extractor) return;

    if (!initPromise) {
        initPromise = (async () => {
            classifier = await pipeline('zero-shot-classification', 'Xenova/mobilebert-uncased-mnli');
            extractor = await pipeline('question-answering', 'Xenova/distilbert-base-uncased-distilled-squad');
        })();
    }

    await initPromise;
}

const JOB_CATEGORIES = [
    "Software Developer or Engineer",
    "Web Designer or UI/UX Designer",
    "Recruiter or HR",
    "Sales or Marketing",
    "Other"
];

const EXPERIENCE_LEVELS = [
    "Experienced professional with years of work experience",
    "Fresh graduate or entry level candidate or intern",
    "Cannot determine experience level"
];

export interface SmartExtractionResult {
    jobTitle: string;
    category: "Developer" | "Web Designer" | "Recruiter" | "Sales/Marketing" | "unclear";
    experienceStatus: "experienced" | "fresher" | "unclear";
    confidence: {
        title: number;
        category: number;
        experience: number;
    };
}

function tryPatternExtraction(subject: string, body?: string): string | null {
    const subjectPatterns = [
        // Indeed specific
        /New\s+Message\s+from\s+.+?\s*[–-]\s*(.+?)$/i,
        /\[Action\s+required\]\s+New\s+application\s+for\s+(.+?)(?:,|\s*\d+\s*at|$)/i,

        // General specific
        /^Application\s+for\s+(.+?)(?:\s*\(|\s+Role|\s+Position|$)/i,
        /^New\s+application\s+received\s+for\s+the\s+position\s+of\s+(.+?)(?:\s+at\s+|\s*\[|$)/i,
        /^Job\s+Opening:\s*(.+?)(?:\s*\[|\s+at|$)/i,
        /^Applying\s+for\s+(?:the\s+)?(.+?)(?:\s+(?:position|role|job)|$)/i,

        // Reply / Forward formats
        /^(?:Re|Fwd|FW|回复|转发):\s*Application\s+for\s+(.+?)(?:\s*\(|\s+Role|\s+Position|$)/i,
        /^(?:Re|Fwd|FW|回复|转发):\s*New\s+application\s+received\s+for\s+the\s+position\s+of\s+(.+?)(?:\s+at\s+|\s*\[|$)/i,
        /^(?:Re|Fwd|FW|回复|转发):\s*Job\s+Opening:\s*(.+?)(?:\s*\[|\s+at|$)/i,
        /^(?:Re|Fwd|FW|回复|转发):\s*Applying\s+for\s+(?:the\s+)?(.+?)(?:\s+(?:position|role|job)|$)/i,
        /^(?:Re|Fwd|FW|回复|转发):\s*(.+?)(?:\s+position|\s+role|\s+Application)$/i,

        // Indeed format "Role - Immediate Joiner"
        /^(.+?)\s*[–-]\s*Immediate\s+Joiner/i,

        // Submission format
        /Submission\s+of\s+.+?[–-]\s*(.+?)$/i,
    ];

    const bodyPatterns = [
        /(?:I am|I'm)\s+(?:applying|interested)\s+for\s+(?:the\s+)?(.+?)(?:\s+(?:position|role|job)|$)/i,
        /(?:I would like to confirm|applying)\s+for\s+(?:the\s+)?(.+?)(?:\s+(?:position|role|job)|$)/i,
        /(?:position|role|post)\s+of\s+(?:the\s+)?(.+?)(?:\s+(?:position|role|job|at)|$)/i,
        /(?:applying|applied)\s+for\s+(?:the\s+)?(.+?)(?:\s+(?:position|role|job)|$)/i,
    ];

    const roleKeywords = ["developer", "engineer", "designer", "manager", "analyst", "consultant", "specialist", "recruiter", "intern", "lead", "architect", "tester", "programmer", "recruitments"];

    const extract = (text: string, patterns: RegExp[]) => {
        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match && match[1]) {
                let title = match[1].trim()
                    .replace(/\s*\(.*\)$/, '')
                    .replace(/^for\s+/i, '')
                    .replace(/^the\s+/i, '')
                    .replace(/\s+(job|role|position)$/i, '')
                    .replace(/\s+at\s+.+$/i, '')
                    .trim();

                if (title.length > 2 && title.length <= 60) {
                    if (roleKeywords.some(kw => title.toLowerCase().includes(kw))) {
                        return title;
                    }
                }
            }
        }
        return null;
    };

    return extract(subject, subjectPatterns) || (body ? extract(body, bodyPatterns) : null);
}

async function extractJobTitle(subject: string, body: string): Promise<{ title: string; confidence: number }> {
    const patternTitle = tryPatternExtraction(subject, body);
    if (patternTitle) {
        return { title: patternTitle, confidence: 0.8 };
    }

    const contextParts = [];
    if (subject) {
        contextParts.push(`The email subject is: "${subject}".`);
    }
    if (body && body.trim().length > 0) {
        contextParts.push(`The email body says: ${body.slice(0, 2000)}`);
    }
    const context = contextParts.join(' ');

    if (context.length < 20) {
        return { title: "unclear", confidence: 0 };
    }

    const questions = [
        "What job position is mentioned?",
        "What role is the person applying for?",
    ];

    let bestAnswer = "";
    let bestScore = 0;

    for (const question of questions) {
        try {
            const result = await extractor(context, question, {
                max_answer_len: 40,
                max_seq_len: 512
            });

            const answer = result.answer.trim();
            const answerLower = answer.toLowerCase();

            const questionWords = ["what", "which", "who", "job title", "mentioned", "applying for"];
            const containsQuestionWords = questionWords.filter(w => answerLower.includes(w)).length >= 2;
            if (containsQuestionWords) continue;
            if (answer.length < 3 || answer.length > 50) continue;
            if (answerLower === "the email subject is" || answerLower === "the email body says") continue;

            if (result.score > bestScore) {
                bestScore = result.score;
                bestAnswer = answer;
            }
        } catch {
            // continue
        }
    }

    if (bestAnswer && bestScore > 0.05) {
        return { title: bestAnswer, confidence: bestScore };
    }

    return { title: "unclear", confidence: 0 };
}

async function classifyApplication(text: string): Promise<{
    category: SmartExtractionResult["category"];
    experienceStatus: SmartExtractionResult["experienceStatus"];
    categoryConfidence: number;
    experienceConfidence: number;
}> {
    const truncatedText = text.slice(0, 2000);
    const textLength = truncatedText.length;

    const categoryResult = await classifier(truncatedText, JOB_CATEGORIES, {
        multi_label: false
    });

    const experienceResult = await classifier(truncatedText, EXPERIENCE_LEVELS, {
        multi_label: false
    });

    const topCategory = categoryResult.labels[0];
    const categoryScore = categoryResult.scores[0];

    let category: SmartExtractionResult["category"] = "unclear";
    if (categoryScore > 0.3) {
        if (topCategory.includes("Developer") || topCategory.includes("Engineer")) {
            category = "Developer";
        } else if (topCategory.includes("Designer")) {
            category = "Web Designer";
        } else if (topCategory.includes("Recruiter") || topCategory.includes("HR")) {
            category = "Recruiter";
        } else if (topCategory.includes("Sales") || topCategory.includes("Marketing")) {
            category = "Sales/Marketing";
        }
    }

    const topExperience = experienceResult.labels[0];
    const experienceScore = experienceResult.scores[0];

    let experienceStatus: SmartExtractionResult["experienceStatus"] = "unclear";

    const hasYearsExperience = /\b(?:[2-9]|\d{2,})\s*(years?|yrs?)\s*(of)?\s*experience/i.test(truncatedText);
    const hasOneYearExperience = /\b1\s*(year|yr)\s*(of)?\s*experience/i.test(truncatedText);
    const hasFresherMarker = /fresher|fresh graduate|entry level|internship|intern\b|recently completed|just graduated/i.test(truncatedText);

    if (hasYearsExperience) {
        experienceStatus = "experienced";
    } else if (hasFresherMarker) {
        experienceStatus = "fresher";
    } else if (hasOneYearExperience) {
        // 1 year can be borderline, but usually marked as experienced unless fresher keywords also present
        experienceStatus = "experienced";
    } else if (textLength > 100 && experienceScore > 0.5) {
        if (topExperience.includes("Experienced")) {
            experienceStatus = "experienced";
        } else if (topExperience.includes("Fresh") || topExperience.includes("entry")) {
            experienceStatus = "fresher";
        }
    }

    return {
        category,
        experienceStatus,
        categoryConfidence: categoryScore,
        experienceConfidence: experienceScore
    };
}

export async function extractJobApplication(subject: string, body: string): Promise<SmartExtractionResult> {
    await initModels();

    const fullText = `${subject} ${body}`.trim();
    if (fullText.length < 10) {
        return {
            jobTitle: "unclear",
            category: "unclear",
            experienceStatus: "unclear",
            confidence: { title: 0, category: 0, experience: 0 }
        };
    }

    try {
        const { title, confidence: titleConfidence } = await extractJobTitle(subject, body);
        let { category, experienceStatus, categoryConfidence, experienceConfidence } = await classifyApplication(fullText);

        // Override category based on job title keywords for better accuracy
        const titleLower = title.toLowerCase();
        if (titleLower.includes("developer") || titleLower.includes("engineer") ||
            titleLower.includes("devops") || titleLower.includes("programmer") ||
            titleLower.includes("backend") || titleLower.includes("frontend") ||
            titleLower.includes("full stack") || titleLower.includes("fullstack")) {
            category = "Developer";
        } else if (titleLower.includes("designer") || titleLower.includes("ui/ux") || titleLower.includes("ux/ui")) {
            category = "Web Designer";
        } else if (titleLower.includes("recruiter") || titleLower.includes("hr ") || titleLower.includes("talent")) {
            category = "Recruiter";
        } else if (titleLower.includes("sales") || titleLower.includes("marketing")) {
            category = "Sales/Marketing";
        }

        return {
            jobTitle: title,
            category,
            experienceStatus,
            confidence: {
                title: titleConfidence,
                category: categoryConfidence,
                experience: experienceConfidence
            }
        };

    } catch (err) {
        console.error("[SmartExtract] Extraction error:", err);
        return {
            jobTitle: "unclear",
            category: "unclear",
            experienceStatus: "unclear",
            confidence: { title: 0, category: 0, experience: 0 }
        };
    }
}
