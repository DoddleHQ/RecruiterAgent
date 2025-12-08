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

function tryPatternExtraction(subject: string): string | null {
    if (!subject) return null;

    const patterns = [
        // Indeed: "New Message from Name - Role"
        /New\s+Message\s+from\s+.+?\s*[–-]\s*(.+?)$/i,
        // Indeed: "[Action required] New application for Role, Location"
        /\[Action\s+required\]\s+New\s+application\s+for\s+(.+?)(?:,|\s*$)/i,
        // "New application received for the position of X at Company"
        /position\s+of\s+(.+?)(?:\s+at\s+|\s*\[|$)/i,
        // "Application for X" or "Apply for X"
        /(?:application|apply)\s+for\s+(.+?)(?:\s+(?:job|position|at)|$|\s*\()/i,
        // "Job Opening: X"
        /job\s+opening:\s*(.+?)(?:\s*\[|\s+at|$)/i,
        // "Applying for the X"
        /applying\s+for\s+(?:the\s+)?(.+?)(?:\s+(?:position|role)|$)/i,
        // "Looking for a X job role"
        /looking\s+for\s+(?:a\s+)?(.+?)\s+(?:job|role|position)/i,
        // "I am X" or "I'm X"
        /^(?:I\s+am|I'm)\s+(?:a\s+)?(.+?)$/i,
        // "Submission of ... – X"
        /submission\s+.+?[–-]\s*(.+?)$/i,
        // "X – Immediate Joiner"
        /^(.+?)\s*[–-]\s*Immediate\s+Joiner/i,
        // "Subject: ... – X"
        /Subject:\s*.+?[–-]\s*(.+?)$/i,
    ];

    for (const pattern of patterns) {
        const match = subject.match(pattern);
        if (match && match[1]) {
            let title = match[1].trim()
                .replace(/\s*\(.*\)$/, '')
                .replace(/\s+(job|role|position)$/i, '')
                .replace(/\s+at\s+.+$/i, '')
                .trim();

            if (title.length > 2 && title.length <= 60) {
                return title;
            }
        }
    }

    const roleKeywords = ["developer", "engineer", "designer", "manager", "analyst", "consultant", "specialist", "recruiter", "intern", "lead", "architect", "tester"];
    const subjectLower = subject.toLowerCase();

    if (roleKeywords.some(kw => subjectLower.includes(kw))) {
        let title = subject
            .replace(/^(Re:\s*)?/i, "")
            .replace(/^(Subject:\s*)?/i, "")
            .replace(/\s*(at\s+.+|\(.*\)|–.*|-\s*Immediate.*|\[.*)$/i, "")
            .trim();

        if (title.length > 2 && title.length <= 60) {
            return title;
        }
    }

    return null;
}

async function extractJobTitle(subject: string, body: string): Promise<{ title: string; confidence: number }> {
    const patternTitle = tryPatternExtraction(subject);
    if (patternTitle) {
        return { title: patternTitle, confidence: 0.8 };
    }

    const contextParts = [];
    if (subject) {
        contextParts.push(`The email subject is: "${subject}".`);
    }
    if (body && body.trim().length > 0) {
        contextParts.push(`The email body says: ${body.slice(0, 400)}`);
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
    const truncatedText = text.slice(0, 500);
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

    const hasYearsExperience = /\d+\s*(years?|yrs?)\s*(of)?\s*experience/i.test(truncatedText);
    const hasFresherMarker = /fresher|fresh graduate|entry level|internship|intern\b|recently completed|just graduated/i.test(truncatedText);

    if (hasYearsExperience) {
        experienceStatus = "experienced";
    } else if (hasFresherMarker) {
        experienceStatus = "fresher";
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
