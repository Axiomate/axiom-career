import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface Job {
  title: string;
  company: string;
  location: string;
  postedAt: string;
  link: string;
  description: string;
  source: string;
  isEasyApply: boolean;
  contactEmail?: string;
}

export interface ResumeAnalysis {
  skills: string[];
  experienceLevel: string;
  suggestedRoles: string[];
  summary: string;
  location?: string;
  experience: string;
  education: string;
  projects: string;
}

export const analyzeResume = async (resumeText: string): Promise<ResumeAnalysis> => {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Analyze the following resume text and extract key information. 
    
    CRITICAL: VERBATIM SKILL EXTRACTION ONLY
    - You are a literal text extractor. 
    - You MUST ONLY extract skills that are explicitly written in the provided Resume Text.
    - DO NOT use your internal knowledge to suggest skills the candidate "likely" has.
    - DO NOT include generic soft skills.
    
    Return a JSON object with:
    - skills: array of strings (ONLY verbatim, high-impact technical/professional skills found in the text)
    - experienceLevel: string (e.g., Junior, Mid, Senior, Lead)
    - suggestedRoles: array of strings (top 3 job titles to search for based on the resume)
    - summary: a brief professional summary of the candidate
    - location: string (the candidate's current city/state or preferred work location if mentioned, otherwise null)
    - experience: string (The work experience section verbatim, cleaned for readability)
    - education: string (The education section verbatim)
    - projects: string (The projects section verbatim, if any)
    
    Resume Text:
    ${resumeText}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          skills: { type: Type.ARRAY, items: { type: Type.STRING } },
          experienceLevel: { type: Type.STRING },
          suggestedRoles: { type: Type.ARRAY, items: { type: Type.STRING } },
          summary: { type: Type.STRING },
          location: { type: Type.STRING, nullable: true },
          experience: { type: Type.STRING },
          education: { type: Type.STRING },
          projects: { type: Type.STRING },
        },
        required: ["skills", "experienceLevel", "suggestedRoles", "summary", "experience", "education", "projects"],
      },
    },
  });

  const result = JSON.parse(response.text || "{}");
  
  // Second layer of filtering: Client-side verification
  if (result.skills && Array.isArray(result.skills)) {
    const lowerResume = resumeText.toLowerCase();
    result.skills = result.skills.filter((skill: string) => {
      const lowerSkill = skill.toLowerCase();
      // Check if the skill exists as a verbatim substring in the text
      return lowerResume.includes(lowerSkill);
    });
  }

  return result;
};

export const structureResume = async (rawText: string): Promise<string> => {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `You are a professional resume formatter. 
    Clean and structure the following raw resume text into a professional, well-organized document.
    
    STRICT FORMATTING RULES:
    1. Use ALL CAPS for main section headers (e.g., SUMMARY, EXPERIENCE, EDUCATION, SKILLS).
    2. Use bullet points (starting with '•') for responsibilities and achievements.
    3. Ensure dates and company names are on their own lines or clearly separated.
    4. Remove any noise like page numbers, broken characters, or system paths.
    5. Maintain the original hierarchy and information.
    
    Raw Text:
    ${rawText}
    
    Return ONLY the cleaned and structured resume text.`,
  });
  return response.text || rawText;
};

export const searchJobs = async (
  analysis: ResumeAnalysis,
  timeFilter: "24h" | "48h" | "72h",
  jobType: "all" | "onsite" | "hybrid" | "remote" = "all"
): Promise<Job[]> => {
  const timeQuery = timeFilter === "24h" ? "last 24 hours" : timeFilter === "48h" ? "last 2 days" : "last 3 days";
  const roles = analysis.suggestedRoles.join(", ");
  const skills = analysis.skills.slice(0, 5).join(", ");
  
  let locationConstraint = analysis.location 
    ? `STRICTLY filter for jobs in or near ${analysis.location}.`
    : "If no specific location is found, search globally or for major tech hubs.";

  if (jobType === "remote") {
    locationConstraint = "ONLY search for 100% REMOTE jobs. Ignore any specific location mentioned on the resume for the job location itself, though the candidate's location is still relevant for timezones.";
  } else if (jobType === "hybrid") {
    locationConstraint += " ONLY search for HYBRID roles (partially remote, partially onsite).";
  } else if (jobType === "onsite") {
    locationConstraint += " ONLY search for ONSITE roles (no remote work).";
  }
  
  const prompt = `Find real, verified job openings for someone with these roles: ${roles}. 
  Key skills: ${skills}. 
  Experience level: ${analysis.experienceLevel}.
  ${locationConstraint}
  Filter for jobs posted in the ${timeQuery}.
  
  CRITICAL: DIRECT APPLICATION LINKS ONLY
  - You MUST find the actual job posting URL (e.g., the specific LinkedIn job ID page, the company's Greenhouse/Lever/Workday link, or the specific Indeed job page).
  - DO NOT return generic homepage links like "https://www.linkedin.com" or "https://www.google.com/search".
  - If you cannot find a direct link for a specific job, do not include that job in the results.
  
  Focus on trusted sources like LinkedIn, Indeed, Glassdoor, or direct company career pages.
  
  Return a list of jobs as a JSON array. Each job should have:
  - title: Job title
  - company: Company name
  - location: Job location
  - postedAt: When it was posted (e.g., "12 hours ago")
  - link: Direct URL to the job posting
  - description: Short summary of the role
  - source: The website name where the job was found
  - isEasyApply: boolean (true if it looks like a quick apply process)
  - contactEmail: string (Extract an email address or mailto link if mentioned in the ad for applications, otherwise null)
  
  Only return the JSON array.`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }],
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            company: { type: Type.STRING },
            location: { type: Type.STRING },
            postedAt: { type: Type.STRING },
            link: { type: Type.STRING },
            description: { type: Type.STRING },
            source: { type: Type.STRING },
            isEasyApply: { type: Type.BOOLEAN },
            contactEmail: { type: Type.STRING, nullable: true },
          },
          required: ["title", "company", "location", "postedAt", "link", "description", "source", "isEasyApply"],
        },
      },
    },
  });

  try {
    return JSON.parse(response.text || "[]");
  } catch (e) {
    console.error("Failed to parse jobs JSON", e);
    return [];
  }
};

export const generateTailoredContent = async (
  resumeText: string,
  job: Job
): Promise<{ tailoredResume: string; coverLetter: string }> => {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `You are an expert career coach. I will provide a resume and a job description.
    
    TASK 1: TAILORED RESUME
    - Update the provided resume to better align with the job description.
    - STRICT: You MUST preserve the EXACT layout, structure, headers, and spacing of the original resume.
    - The output should look like a professional document. Use clear section headers (e.g., EXPERIENCE, EDUCATION, SKILLS).
    - Use bullet points for responsibilities.
    - ONLY modify the content within the existing structure to highlight relevant experience for this specific job.
    - DO NOT add fake experience.
    - Ensure the final text is ready to be printed as a professional PDF.
    
    TASK 2: COVER LETTER
    - Write a professional, compelling cover letter for this specific job.
    - Use the candidate's experience from the resume to show why they are a perfect fit.
    
    Job Title: ${job.title}
    Company: ${job.company}
    Job Description: ${job.description}
    
    Original Resume:
    ${resumeText}
    
    Return a JSON object with:
    - tailoredResume: string (The full resume text, tailored but preserving layout)
    - coverLetter: string (The full cover letter text)`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          tailoredResume: { type: Type.STRING },
          coverLetter: { type: Type.STRING },
        },
        required: ["tailoredResume", "coverLetter"],
      },
    },
  });

  return JSON.parse(response.text || "{}");
};

export const generateEmailContent = async (
  resumeText: string,
  job: Job
): Promise<{ subject: string; body: string }> => {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `You are a professional career assistant. Write a professional, well-structured job application email.
    
    Job Title: ${job.title}
    Company: ${job.company}
    Job Description: ${job.description}
    
    Candidate Resume:
    ${resumeText}
    
    STRICT INSTRUCTIONS FOR EMAIL STRUCTURE:
    - Use a clear, professional subject line.
    - Start with a formal salutation.
    - Paragraph 1: State the position you are applying for and why you are interested.
    - Paragraph 2: Highlight 2-3 key achievements or skills from the resume that match the job description.
    - Paragraph 3: Mention that your tailored resume and cover letter are attached.
    - Closing: Professional sign-off.
    
    Return a JSON object with:
    - subject: string (Professional email subject line)
    - body: string (The full email body text with proper line breaks)`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          subject: { type: Type.STRING },
          body: { type: Type.STRING },
        },
        required: ["subject", "body"],
      },
    },
  });

  return JSON.parse(response.text || "{}");
};
