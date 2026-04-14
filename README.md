# Recruit AI Agent

An end-to-end AI-powered recruitment automation system that monitors your inbox, screens job applicants, extracts key information from resumes and cover letters, and drives the entire pre-interview pipeline — from initial application receipt to personalized pre-interview questionnaires — without any manual intervention.

## How It Works

The system runs on a scheduled hourly cycle. Every hour, three core workflows scan your Gmail inbox for new and replied emails, process them through AI-powered analysis, and take automated actions — sending personalized responses, organizing candidates with Gmail labels, and advancing qualified applicants through the pipeline.

### Pipeline Overview

```
New Application Arrives
        |
        v
  Email Ingestion & Deduplication
        |
        v
  AI-Powered Data Extraction
  (Job Title, Category, Experience Level)
        |
        v
  Resume & Cover Letter Detection
        |
        v
  Application Classification
   /    |    |     \
  v     v    v      v
Rejection  Request   Confirm &
Templates  Details   Advance to
           Templates Stage 1
```

---

## Core Workflows

### 1. Direct Application Workflow

Processes job applications received directly via email (Gmail addresses). The workflow:

- Scans the inbox for unread, unprocessed emails
- Skips emails from internal recruiter team members and non-recruitment subjects
- Extracts metadata: sender info, subject, body, attachments
- Detects presence of resume and cover letter through multi-layer analysis
- Classifies the application into a category (Developer, Designer, Recruiter, Sales/Marketing)
- Determines experience level (fresher vs. experienced)
- Routes the candidate into the appropriate response path

### 2. Indeed Integration Workflow

A specialized variant of the direct application workflow, tailored for applications routed through Indeed. It:

- Filters specifically for Indeed-sourced emails
- Extracts resume links from Indeed's HTML email templates
- Handles Indeed's anonymized email format
- Applies the same classification and routing logic as the direct workflow

### 3. Reply Tracking Workflow

Monitors candidates who have already entered the pipeline and tracks their responses. This workflow:

- Watches for replies in threads labeled "Stage1 Interview" or "Pre-Stage"
- Extracts key candidate details from replies (position, CTC, experience, availability)
- Parses attachments and resume content from multi-message threads
- For candidates with complete information, triggers the AI screening pipeline
- For incomplete responses, sends follow-up requests for missing details
- Re-classifies candidates whose replies clarify their application

---

## AI Agents

### Extraction Agent

A specialized agent that parses job application emails and extracts structured data:

- **Job title** with hallucination detection (verifies extracted title exists in source text)
- **Category classification** (Developer, Web Designer, Recruiter, Sales/Marketing)
- **Experience status** (experienced, fresher, or unclear)
- **Candidate details** (current CTC, expected CTC, work experience, location, availability)

Uses a tiered extraction approach with fallbacks:
1. AI-first extraction via LLM
2. One-shot classification via local transformer models
3. Regex-based pattern matching as a final fallback

### Context QA Agent

A RAG-powered agent used during the AI screening phase to:

- Query the vector database for matching job openings
- Retrieve real-time documentation from open-source libraries
- Generate tailored interview questions based on the candidate's resume and the job requirements
- Follow a multi-step prompt chain: sanitize input, search job openings, extract key technologies, fetch documentation insights, and generate questions

---

## Automated Screening & Questionnaire Generation

When a candidate provides all required details and passes initial screening, the system:

1. **Parses the candidate's resume** — extracts text from PDF and DOCX attachments
2. **Matches against open positions** — queries the vector database for relevant job openings based on the applied position
3. **Identifies key technologies** — cross-references the job description and the candidate's resume
4. **Fetches documentation insights** — retrieves real-time documentation for the relevant technologies via Context7 MCP
5. **Generates a personalized pre-interview questionnaire** — 6-8 questions tailored to the candidate's experience level and the role's requirements, with varied question types:
   - Text-based (situation-based, behavioral)
   - Example-based (coding tasks, code review scenarios)
   - Multiple-choice (conceptual knowledge)
   - Riddle-based (problem-solving)
6. **Sends the questionnaire** as a formatted email reply with the candidate's name and position

---

## Smart Document Analysis

### Resume Detection (Multi-Layer)

The system uses a layered approach to determine if a candidate has submitted a resume:

- **Layer 0**: Explicit resume link (Indeed-style)
- **Layer 1**: Keyword matching on attachment filenames (resume, cv, portfolio, etc.)
- **Layer 2**: Body text analysis for resume attachment mentions
- **Layer 3**: Content-based analysis — downloads and parses PDF/DOCX attachments, scanning for resume indicators (experience, education, skills, certifications, etc.)
- **Layer 4**: Minimal keyword presence check as a low-confidence fallback

### Cover Letter Detection

- Analyzes attachment filenames for cover letter indicators
- Scans email body for cover letter language patterns
- Filters out AI-generated placeholder text (detects template variables like `[job title]`, `[company name]`)
- Requires minimum word count and sentence structure to qualify as a genuine cover letter

### Attachment Parsing

- **PDF extraction** via `unpdf`
- **DOCX extraction** via `mammoth`
- **Web URL fetching** for remote resume links

---

## Email Template System

The system uses a template-based email response system with dynamic personalization. Templates are selected based on the candidate's category, experience level, and application status.

### Rejection Templates

| Template | Trigger |
|---|---|
| Missing Multiple Details | Candidate is missing 2+ required items (resume, cover letter, position) |
| No Resume | Candidate has not submitted a resume |
| No Cover Letter | Candidate has not submitted a cover letter |
| No Clear Job Position | The applied position could not be determined |
| High Salary Expectation | Candidate's expected CTC exceeds the range |
| General Rejection | Generic rejection for other cases |

### Request for Details Templates

| Template | Trigger |
|---|---|
| Experienced Developer | Confirmed Developer applicant with prior experience |
| Fresher Developer | Confirmed Developer applicant who is a fresher |
| Non-Technical | Recruiter, Sales/Marketing, and other non-tech roles |
| Creative | Web Designer and UI/UX Designer roles |
| Resend Key Details | Follow-up when candidate's reply had missing information |
| Pre-Questionnaire | Custom AI-generated questionnaire for screened candidates |

All templates support dynamic placeholder replacement (`[Candidate Name]`, `[Job Title]`, `[Company Name]`) and are sent as both HTML and plain-text multipart emails with company branding and signature.

---

## Gmail Integration

- **Service account authentication** — uses a Google service account with domain-wide delegation to impersonate the recruitment email address
- **Label management** — automatically creates and applies Gmail labels to organize candidates through pipeline stages (Inbox, Pre-Stage, Stage1 Interview, Stage1 Pre-Questionnaire, Unclear Applications, Rejected)
- **Thread-aware replies** — all responses are sent as in-thread replies with proper `In-Reply-To` and `References` headers
- **Multi-format email sending** — sends emails as multipart/alternative with both HTML and plain-text versions
- **BCC tracking** — all outgoing emails are BCC'd to a configured address for audit trails
- **Internal team filtering** — automatically skips emails from configured recruiter team members

---

## Job Openings Management

A REST API for managing job openings that power the matching engine:

- **POST** `/api/jobopenings` — Index a new job opening into the vector database. The job description is chunked, embedded, and stored for semantic search.
- **GET** `/api/jobopenings?jobQuery=...` — Search for relevant job openings using semantic similarity search against the query.
- **DELETE** `/api/jobopenings?jobId=...` — Remove a job opening from the RAG index.

---

## Vector Database & Embeddings

- **Embeddings** generated locally using `all-MiniLM-L6-v2` via ONNX Runtime (no external API dependency)
- **Vector store** supports two backends:
  - **Upstash Vector** for development environments
  - **PostgreSQL with pgvector** for production
- Job openings are chunked using Mastra RAG's JSON chunking strategy and indexed with metadata for semantic retrieval

---

## Infrastructure

- **Scheduled execution** — workflows run every hour via `node-cron`
- **Deduplication** — Redis-backed email deduplication with TTL to prevent double-processing
- **Docker support** — full Docker Compose setup with Redis, PostgreSQL (pgvector), and the application container
- **Non-root container** — runs as a non-root user for security
- **Health checks** — built-in HTTP health check endpoint
- **Retry logic** — workflows include configurable retry with exponential backoff

## Tech Stack

| Component | Technology |
|---|---|
| AI Framework | Mastra AI |
| LLM | GLM-4.6 (Zhipu AI) |
| Runtime | Node.js 20+ |
| Language | TypeScript |
| Email | Gmail API (Service Account) |
| Vector DB | Upstash Vector / PostgreSQL (pgvector) |
| Cache & Queue | Redis |
| Embeddings | Xenova/all-MiniLM-L6-v2 (local) |
| Document Parsing | unpdf, mammoth |
| HTML Parsing | Cheerio |
| Documentation | Context7 MCP |
| Containerization | Docker + Docker Compose |

## Getting Started

1. Clone the repository
2. Install dependencies with `npm install`
3. Set up a Google Cloud service account with domain-wide delegation and Gmail API scopes
4. Configure environment variables (see below)
5. Start the application with `npm run dev` (development) or `docker compose up` (production)

## Environment Configuration

| Variable | Description |
|---|---|
| `RECRUITMENT_MAIL` | Gmail address used for recruitment correspondence |
| `CONSULTING_MAIL` | Consulting email address (for reply-to handling) |
| `BCC_MAIL` | BCC address for audit trails |
| `RECRUITER_NAME` | Display name for outgoing emails |
| `RECRUITER_TEAM_MEMBERS` | Comma-separated list of team member names to skip |
| `GROQ_API_KEY` | Groq API key for LLM access |
| `OPENROUTER_API_KEY` | OpenRouter API key |
| `ZHIPU_API_KEY` | Zhipu AI API key |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` | Redis connection details |
| `POSTGRES_VECTOR_CONNECTION_STRING` | PostgreSQL connection string (production) |
| `VECTOR_UPSTASH_URL` / `VECTOR_UPSTASH_TOKEN` | Upstash Vector credentials (development) |
| `FRONTEND_ORIGIN` | CORS origin for the job openings API |
| `NODE_PORT` | Express server port (default: 5000) |
