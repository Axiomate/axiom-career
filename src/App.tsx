/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { 
  Upload, 
  Search, 
  Briefcase, 
  Clock, 
  CheckCircle, 
  ExternalLink, 
  ChevronRight,
  ChevronDown,
  ChevronUp,
  FileText,
  Loader2,
  Filter,
  Plus,
  X,
  Edit2,
  Save,
  Undo2,
  Mail,
  Check,
  AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import * as mammoth from 'mammoth';
import { jsPDF } from 'jspdf';
import { analyzeResume, searchJobs, generateTailoredContent, structureResume, generateEmailContent, type Job, type ResumeAnalysis } from './services/geminiService';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [resumeText, setResumeText] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isGenerating, setIsGenerating] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<ResumeAnalysis | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [expandedJobs, setExpandedJobs] = useState<Set<number>>(new Set());
  const [timeFilter, setTimeFilter] = useState<'24h' | '48h' | '72h'>('24h');
  const [jobType, setJobType] = useState<'all' | 'onsite' | 'hybrid' | 'remote'>('all');
  const [newSkill, setNewSkill] = useState('');
  const [newSkillInModal, setNewSkillInModal] = useState('');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editDraft, setEditDraft] = useState<ResumeAnalysis | null>(null);
  const [history, setHistory] = useState<ResumeAnalysis[]>([]);
  const [emailModalJob, setEmailModalJob] = useState<Job | null>(null);
  const [emailOptions, setEmailOptions] = useState({
    attachTailoredResume: true,
    attachTailoredCoverLetter: true,
    generateMailContent: true,
    attachUploadedResume: false
  });
  const [isSendingMail, setIsSendingMail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const arrayBuffer = e.target?.result as ArrayBuffer;
        
        try {
          setIsAnalyzing(true);
          setError(null);
          
          let rawText = '';
          if (file.name.endsWith('.docx')) {
            const result = await mammoth.extractRawText({ arrayBuffer });
            rawText = result.value;
          } else {
            const decoder = new TextDecoder();
            rawText = decoder.decode(arrayBuffer);
          }
          
          if (!rawText.trim()) {
            throw new Error('Could not extract text from file.');
          }

          // Step 1: Structure the raw text using Gemini
          const structuredText = await structureResume(rawText);
          setResumeText(structuredText);
          
          // Step 2: Analyze the structured text
          const result = await analyzeResume(structuredText);
          setAnalysis(result);
          handleSearch(result, timeFilter);
        } catch (err) {
          setError('Failed to process resume. Please try a different format or a .txt file.');
          console.error(err);
        } finally {
          setIsAnalyzing(false);
        }
      };
      reader.readAsArrayBuffer(file);
    }
  }, [timeFilter]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/plain': ['.txt'],
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
    },
    multiple: false
  });

  const handleSearch = async (
    currentAnalysis: ResumeAnalysis, 
    filter: '24h' | '48h' | '72h',
    type: 'all' | 'onsite' | 'hybrid' | 'remote' = jobType
  ) => {
    setIsSearching(true);
    setError(null);
    try {
      const results = await searchJobs(currentAnalysis, filter, type);
      setJobs(results);
    } catch (err) {
      setError('Failed to fetch jobs. Please try again.');
      console.error(err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleGenerateTailored = async (job: Job, type: 'resume' | 'coverLetter') => {
    setIsGenerating(`${job.link}-${type}`);
    try {
      const { tailoredResume, coverLetter } = await generateTailoredContent(resumeText, job);
      
      if (type === 'resume') {
        downloadAsPDF(tailoredResume, `Tailored_Resume_${job.company.replace(/\s+/g, '_')}.pdf`);
      } else {
        downloadAsPDF(coverLetter, `Cover_Letter_${job.company.replace(/\s+/g, '_')}.pdf`);
      }

    } catch (err) {
      setError(`Failed to generate tailored ${type}.`);
      console.error(err);
    } finally {
      setIsGenerating(null);
    }
  };

  const toggleJobExpansion = (index: number) => {
    setExpandedJobs(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const changeFilter = (newFilter: '24h' | '48h' | '72h') => {
    setTimeFilter(newFilter);
    if (analysis) {
      handleSearch(analysis, newFilter, jobType);
    }
  };

  const changeJobType = (newType: 'all' | 'onsite' | 'hybrid' | 'remote') => {
    setJobType(newType);
    if (analysis) {
      handleSearch(analysis, timeFilter, newType);
    }
  };

  const handleAddSkill = (e: React.FormEvent) => {
    e.preventDefault();
    if (newSkill.trim() && analysis) {
      const updatedAnalysis = {
        ...analysis,
        skills: [...new Set([...analysis.skills, newSkill.trim()])]
      };
      setAnalysis(updatedAnalysis);
      setNewSkill('');
      handleSearch(updatedAnalysis, timeFilter, jobType);
    }
  };

  const handleRemoveSkill = (skillToRemove: string) => {
    if (analysis) {
      const updatedAnalysis = {
        ...analysis,
        skills: analysis.skills.filter(s => s !== skillToRemove)
      };
      setAnalysis(updatedAnalysis);
      handleSearch(updatedAnalysis, timeFilter, jobType);
    }
  };

  const openEditModal = () => {
    if (analysis) {
      setEditDraft({ ...analysis });
      setHistory([{ ...analysis }]);
      setIsEditModalOpen(true);
    }
  };

  const handleUpdateDraft = (field: keyof ResumeAnalysis, value: any) => {
    if (editDraft) {
      setEditDraft({ ...editDraft, [field]: value });
    }
  };

  const saveField = (field: keyof ResumeAnalysis) => {
    if (editDraft) {
      setHistory(prev => [...prev, { ...editDraft }]);
      // In this specific UI, "Save" just confirms the current draft state for that field
      // but we only apply to global state on "Refine Search"
    }
  };

  const undoField = () => {
    if (history.length > 1) {
      const previous = history[history.length - 2];
      setEditDraft(previous);
      setHistory(prev => prev.slice(0, -1));
    }
  };

  const handleRefineSearch = () => {
    if (editDraft) {
      setAnalysis(editDraft);
      setIsEditModalOpen(false);
      handleSearch(editDraft, timeFilter, jobType);
    }
  };

  const downloadAsPDF = (content: string, filename: string) => {
    const doc = new jsPDF();
    const margin = 20;
    const pageWidth = doc.internal.pageSize.getWidth();
    const lines = content.split('\n');
    let y = 20;

    // Helper to add a horizontal line
    const addLine = (currY: number) => {
      doc.setDrawColor(200, 200, 200);
      doc.line(margin, currY, pageWidth - margin, currY);
      return currY + 5;
    };

    lines.forEach(line => {
      const trimmedLine = line.trim();
      if (!trimmedLine) {
        y += 4;
        return;
      }

      // Detect Section Headers (e.g., EXPERIENCE, EDUCATION, or # Header)
      const isHeader = /^[A-Z\s]{3,}$/.test(trimmedLine) || 
                       /^(EXPERIENCE|EDUCATION|SKILLS|PROJECTS|SUMMARY|CONTACT|WORK HISTORY)/i.test(trimmedLine) ||
                       trimmedLine.startsWith('#');
      
      // Detect Bullet Points
      const isBullet = trimmedLine.startsWith('•') || trimmedLine.startsWith('-') || trimmedLine.startsWith('*');

      if (isHeader) {
        const headerText = trimmedLine.replace(/^#\s*/, '').toUpperCase();
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(40, 40, 40);
        
        if (y > 20) y += 6; // Extra space before header
        
        doc.text(headerText, margin, y);
        y += 2;
        y = addLine(y);
      } else if (isBullet) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(60, 60, 60);
        
        const bulletText = trimmedLine.replace(/^[•\-*]\s*/, '');
        const splitText = doc.splitTextToSize(bulletText, pageWidth - margin * 2 - 5);
        
        doc.text('•', margin + 2, y);
        doc.text(splitText, margin + 7, y);
        y += splitText.length * 5.5;
      } else {
        // Normal text or sub-headers (like Company Name, Dates)
        const isSubHeader = /^[A-Za-z0-9\s&,.-]+(\s\|\s|\s\s\s)[A-Za-z0-9\s,.-]+$/.test(trimmedLine) || 
                            trimmedLine.length < 50 && (trimmedLine.includes('20') || trimmedLine.includes('Present'));

        if (isSubHeader) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(10.5);
          doc.setTextColor(50, 50, 50);
        } else {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(10);
          doc.setTextColor(60, 60, 60);
        }

        const splitText = doc.splitTextToSize(trimmedLine, pageWidth - margin * 2);
        
        // Check for page overflow
        if (y + (splitText.length * 5) > 275) {
          doc.addPage();
          y = 20;
        }

        doc.text(splitText, margin, y);
        y += splitText.length * 5.5;
      }
    });

    doc.save(filename);
  };

  const handleSendMail = async () => {
    if (!emailModalJob) return;
    setIsSendingMail(true);
    try {
      let subject = `Application for ${emailModalJob.title} at ${emailModalJob.company}`;
      let body = `Hi ${emailModalJob.company} Team,\n\nI am interested in the ${emailModalJob.title} position.`;

      if (emailOptions.generateMailContent) {
        const content = await generateEmailContent(resumeText, emailModalJob);
        subject = content.subject;
        body = content.body;
      }

      // Prepare attachments info in body (since mailto doesn't support real attachments)
      let attachmentsInfo = "\n\n--- Attachments Prepared (Please attach these files manually) ---";
      
      if (emailOptions.attachTailoredResume || emailOptions.attachTailoredCoverLetter) {
        const { tailoredResume, coverLetter } = await generateTailoredContent(resumeText, emailModalJob);
        
        if (emailOptions.attachTailoredResume) {
          attachmentsInfo += `\n- Tailored Resume (PDF Generated)`;
          downloadAsPDF(tailoredResume, `Tailored_Resume_${emailModalJob.company}.pdf`);
        }
        
        if (emailOptions.attachTailoredCoverLetter) {
          attachmentsInfo += `\n- Tailored Cover Letter (PDF Generated)`;
          downloadAsPDF(coverLetter, `Cover_Letter_${emailModalJob.company}.pdf`);
        }
      }

      if (emailOptions.attachUploadedResume) {
        attachmentsInfo += `\n- Original Uploaded Resume (PDF Generated)`;
        downloadAsPDF(resumeText, `Original_Resume.pdf`);
      }

      const mailtoUrl = `mailto:${emailModalJob.contactEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body + attachmentsInfo)}`;
      window.location.href = mailtoUrl;
      setEmailModalJob(null);
    } catch (err) {
      setError('Failed to prepare email application.');
      console.error(err);
    } finally {
      setIsSendingMail(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#020617] text-slate-100 font-sans selection:bg-amber-500/30">
      {/* Header */}
      <header className="bg-[#020617]/80 backdrop-blur-md border-b border-slate-800 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-amber-500 p-2 rounded-lg shadow-lg shadow-amber-500/20">
              <Briefcase className="w-6 h-6 text-slate-900" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-white">CareerPulse</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-400 hidden sm:inline">AI-Powered Job Matching</span>
            {analysis && (
              <button 
                onClick={() => { setAnalysis(null); setJobs([]); setResumeText(''); }}
                className="text-sm font-medium text-amber-400 hover:text-amber-300 transition-colors"
              >
                Upload New
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {!analysis ? (
          <div className="max-w-2xl mx-auto mt-12">
            <div className="text-center mb-10">
              <motion.h2 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-4xl sm:text-5xl font-extrabold text-white mb-4 tracking-tight"
              >
                Find your next role <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-orange-500">in seconds.</span>
              </motion.h2>
              <p className="text-lg text-slate-400">
                Upload your resume and let our AI find the most relevant, verified job openings from the last 72 hours.
              </p>
            </div>

            <div 
              {...getRootProps()} 
              className={cn(
                "border-2 border-dashed rounded-3xl p-16 transition-all cursor-pointer flex flex-col items-center justify-center gap-6 group relative overflow-hidden",
                isDragActive 
                  ? "border-amber-500 bg-amber-500/5" 
                  : "border-slate-800 bg-slate-900/50 hover:border-amber-500/50 hover:bg-slate-900/80"
              )}
            >
              <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <input {...getInputProps()} />
              <div className="bg-amber-500/10 p-6 rounded-full group-hover:scale-110 transition-transform">
                <Upload className="w-10 h-10 text-amber-500" />
              </div>
              <div className="text-center relative z-10">
                <p className="text-xl font-semibold text-white">
                  {isDragActive ? "Drop your resume here" : "Click or drag resume to upload"}
                </p>
                <p className="text-sm text-slate-500 mt-2">Supports PDF, DOCX, and TXT files</p>
              </div>
            </div>

            <div className="mt-8 bg-slate-900/50 border border-slate-800 rounded-2xl p-5 flex gap-4">
              <div className="bg-amber-500/10 p-2 rounded-lg h-fit">
                <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />
              </div>
              <p className="text-sm text-slate-400 leading-relaxed">
                <span className="text-amber-500 font-semibold">Pro Tip:</span> For best results, ensure your resume text is clear. If uploading a PDF, we'll extract the text content for analysis.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Sidebar: Analysis Summary */}
            <aside className="lg:col-span-4 space-y-6">
              <motion.div 
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                className="bg-slate-900/50 rounded-3xl border border-slate-800 p-8 shadow-xl backdrop-blur-sm"
              >
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className="bg-amber-500/10 p-2 rounded-lg">
                      <FileText className="w-5 h-5 text-amber-500" />
                    </div>
                    <h3 className="font-bold text-xl text-white">Resume Profile</h3>
                  </div>
                  <button 
                    onClick={openEditModal}
                    className="p-2 text-slate-400 hover:text-amber-500 hover:bg-amber-500/10 rounded-xl transition-all"
                    title="Edit Parsed Data"
                  >
                    <Edit2 className="w-5 h-5" />
                  </button>
                </div>
                
                <div className="space-y-6">
                  <div>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-2">Experience Level</p>
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-amber-500/10 text-amber-500 border border-amber-500/20">
                      {analysis.experienceLevel}
                    </span>
                  </div>

                  {analysis.location && (
                    <div>
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-2">Location</p>
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-800 text-slate-200 border border-slate-700">
                        <Filter className="w-3 h-3 text-amber-500" />
                        {analysis.location}
                      </span>
                    </div>
                  )}

                  <div>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-3">Top Skills</p>
                    <div className="flex flex-wrap gap-2 mb-4">
                      {analysis.skills.map((skill, i) => (
                        <span key={i} className="group/skill px-3 py-1 bg-slate-800/50 rounded-lg text-sm text-slate-300 border border-slate-700/50 flex items-center gap-2">
                          {skill}
                          <button 
                            onClick={() => handleRemoveSkill(skill)}
                            className="opacity-0 group-hover/skill:opacity-100 text-slate-500 hover:text-rose-400 transition-all"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                    <form onSubmit={handleAddSkill} className="relative">
                      <input 
                        type="text"
                        value={newSkill}
                        onChange={(e) => setNewSkill(e.target.value)}
                        placeholder="Add a skill..."
                        className="w-full bg-slate-800/30 border border-slate-700 rounded-xl py-2 px-4 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-amber-500/50 transition-all pr-10"
                      />
                      <button 
                        type="submit"
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-amber-500 hover:bg-amber-500/10 rounded-lg transition-all"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </form>
                  </div>

                  <div>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-2">Summary</p>
                    <p className="text-sm text-slate-400 leading-relaxed italic border-l-2 border-amber-500/30 pl-4">
                      "{analysis.summary}"
                    </p>
                  </div>
                </div>
              </motion.div>

              <div className="bg-gradient-to-br from-amber-600 to-orange-700 rounded-3xl p-8 text-white shadow-2xl overflow-hidden relative group">
                <div className="relative z-10">
                  <h4 className="font-bold text-xl mb-3">Verified Jobs Only</h4>
                  <p className="text-white/80 text-sm leading-relaxed">
                    We only source from trusted platforms like LinkedIn, Indeed, and direct company career portals to ensure you're seeing real opportunities.
                  </p>
                </div>
                <CheckCircle className="absolute -bottom-6 -right-6 w-32 h-32 text-white/10 group-hover:scale-110 transition-transform duration-500" />
              </div>
            </aside>

            {/* Main Content: Job Listings */}
            <section className="lg:col-span-8 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <h2 className="text-2xl font-bold text-white">Recommended Jobs</h2>
                  {isSearching && <Loader2 className="w-5 h-5 animate-spin text-amber-500" />}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center bg-slate-900 border border-slate-800 rounded-xl p-1 shadow-inner">
                    {(['all', 'onsite', 'hybrid', 'remote'] as const).map((type) => (
                      <button
                        key={type}
                        onClick={() => changeJobType(type)}
                        className={cn(
                          "px-4 py-2 text-xs font-bold rounded-lg transition-all whitespace-nowrap capitalize",
                          jobType === type 
                            ? "bg-slate-700 text-white shadow-lg" 
                            : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                        )}
                      >
                        {type}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center bg-slate-900 border border-slate-800 rounded-xl p-1 shadow-inner">
                    {(['72h', '48h', '24h'] as const).map((filter) => (
                      <button
                        key={filter}
                        onClick={() => changeFilter(filter)}
                        className={cn(
                          "px-4 py-2 text-xs sm:text-sm font-bold rounded-lg transition-all whitespace-nowrap",
                          timeFilter === filter 
                            ? "bg-amber-500 text-slate-900 shadow-lg" 
                            : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                        )}
                      >
                        {filter === '72h' ? 'Last 72h' : filter === '48h' ? 'Last 48h' : 'Last 24h'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {error && (
                <div className="bg-rose-500/10 border border-rose-500/20 rounded-2xl p-5 flex gap-4 text-rose-400">
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  <p className="text-sm font-semibold">{error}</p>
                </div>
              )}

              <div className="space-y-4">
                <AnimatePresence mode="popLayout">
                  {isSearching ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="bg-slate-900/30 rounded-3xl border border-slate-800/50 p-8 animate-pulse">
                        <div className="h-7 bg-slate-800 rounded-lg w-1/3 mb-4"></div>
                        <div className="h-4 bg-slate-800 rounded-lg w-1/4 mb-6"></div>
                        <div className="space-y-2">
                          <div className="h-4 bg-slate-800/50 rounded-lg w-full"></div>
                          <div className="h-4 bg-slate-800/50 rounded-lg w-2/3"></div>
                        </div>
                      </div>
                    ))
                  ) : jobs.length > 0 ? (
                    jobs.map((job, index) => (
                      <motion.div
                        key={index}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.05 }}
                        className="group bg-slate-900/40 rounded-3xl border border-slate-800 p-8 shadow-sm hover:shadow-amber-500/5 hover:border-amber-500/30 transition-all duration-300 backdrop-blur-sm"
                      >
                        <div className="flex flex-col sm:flex-row justify-between gap-6">
                          <div className="flex-1">
                            <div className="flex items-start justify-between mb-2">
                              <div className="flex items-center gap-3">
                                <h3 className="text-2xl font-bold text-white group-hover:text-amber-400 transition-colors">
                                  {job.title}
                                </h3>
                                <button 
                                  onClick={() => toggleJobExpansion(index)}
                                  className="p-1 text-slate-500 hover:text-amber-500 transition-colors"
                                >
                                  {expandedJobs.has(index) ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                                </button>
                              </div>
                              {job.isEasyApply && (
                                <span className="inline-flex items-center px-2.5 py-1 rounded-md text-[10px] font-black bg-amber-500/10 text-amber-500 uppercase tracking-widest border border-amber-500/20">
                                  Easy Apply
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-400 mb-6">
                              <span className="font-bold text-slate-200">{job.company}</span>
                              <span className="flex items-center gap-1.5">
                                <Filter className="w-3.5 h-3.5 text-amber-500/50" /> {job.location}
                              </span>
                              <span className="flex items-center gap-1.5">
                                <Clock className="w-3.5 h-3.5 text-amber-500/50" /> {job.postedAt}
                              </span>
                              <span className="flex items-center gap-1.5 text-amber-400/80 font-bold">
                                <CheckCircle className="w-3.5 h-3.5" /> {job.source}
                              </span>
                            </div>
                            <p className={cn(
                              "text-slate-400 text-sm leading-relaxed group-hover:text-slate-300 transition-colors",
                              !expandedJobs.has(index) && "line-clamp-2"
                            )}>
                              {job.description}
                            </p>
                          </div>
                          <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-3 shrink-0">
                            <a 
                              href={job.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-2 px-8 py-3 bg-amber-500 text-slate-900 rounded-2xl font-black text-sm hover:bg-amber-400 shadow-lg shadow-amber-500/10 transition-all active:scale-95 whitespace-nowrap w-full justify-center"
                            >
                              Apply Now
                              <ExternalLink className="w-4 h-4" />
                            </a>
                            <button
                              onClick={() => handleGenerateTailored(job, 'resume')}
                              disabled={isGenerating !== null}
                              className="inline-flex items-center gap-2 px-8 py-3 bg-slate-800 text-white rounded-2xl font-bold text-sm hover:bg-slate-700 transition-all active:scale-95 whitespace-nowrap w-full justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {isGenerating === `${job.link}-resume` ? (
                                <>
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                  Tailoring Resume...
                                </>
                              ) : (
                                <>
                                  <FileText className="w-4 h-4" />
                                  Tailor Resume
                                </>
                              )}
                            </button>
                            <button
                              onClick={() => handleGenerateTailored(job, 'coverLetter')}
                              disabled={isGenerating !== null}
                              className="inline-flex items-center gap-2 px-8 py-3 bg-slate-800 text-white rounded-2xl font-bold text-sm hover:bg-slate-700 transition-all active:scale-95 whitespace-nowrap w-full justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {isGenerating === `${job.link}-coverLetter` ? (
                                <>
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                  Tailoring CL...
                                </>
                              ) : (
                                <>
                                  <FileText className="w-4 h-4" />
                                  Tailor Cover Letter
                                </>
                              )}
                            </button>
                            {job.contactEmail && (
                              <button
                                onClick={() => setEmailModalJob(job)}
                                className="inline-flex items-center gap-2 px-8 py-3 bg-emerald-600 text-white rounded-2xl font-bold text-sm hover:bg-emerald-500 transition-all active:scale-95 whitespace-nowrap w-full justify-center"
                              >
                                <Mail className="w-4 h-4" />
                                Send Mail
                              </button>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    ))
                  ) : (
                    <div className="bg-slate-900/20 rounded-3xl border border-slate-800 border-dashed p-20 text-center">
                      <div className="bg-slate-800/50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6">
                        <Search className="w-10 h-10 text-slate-600" />
                      </div>
                      <h3 className="text-xl font-bold text-white">No jobs found</h3>
                      <p className="text-slate-500 mt-2">Try changing the time filter or updating your resume.</p>
                    </div>
                  )}
                </AnimatePresence>
              </div>
            </section>
          </div>
        )}
      </main>

      {/* Edit Modal */}
      <AnimatePresence>
        {isEditModalOpen && editDraft && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsEditModalOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-8 border-b border-slate-800 flex items-center justify-between shrink-0">
                <div>
                  <h3 className="text-2xl font-bold text-white">Edit Parsed Resume</h3>
                  <p className="text-sm text-slate-500 mt-1">Review and refine the data extracted from your resume.</p>
                </div>
                <button 
                  onClick={() => setIsEditModalOpen(false)}
                  className="p-2 text-slate-500 hover:text-white hover:bg-slate-800 rounded-xl transition-all"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="p-8 overflow-y-auto space-y-8 flex-1 custom-scrollbar">
                {[
                  { id: 'summary', label: 'Professional Summary', value: editDraft.summary },
                  { id: 'experience', label: 'Work Experience', value: editDraft.experience },
                  { id: 'education', label: 'Education', value: editDraft.education },
                  { id: 'projects', label: 'Projects', value: editDraft.projects },
                ].map((section) => (
                  <div key={section.id} className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">{section.label}</label>
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => undoField()}
                          className="p-1.5 text-slate-500 hover:text-slate-300 transition-colors"
                          title="Undo"
                        >
                          <Undo2 className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => saveField(section.id as any)}
                          className="p-1.5 text-slate-500 hover:text-emerald-500 transition-colors"
                          title="Save Draft"
                        >
                          <Save className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <textarea 
                      value={section.value}
                      onChange={(e) => handleUpdateDraft(section.id as any, e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-2xl p-4 text-sm text-slate-300 focus:outline-none focus:border-amber-500/50 min-h-[120px] resize-none transition-all"
                    />
                  </div>
                ))}

                <div className="space-y-3">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">Skills</label>
                  <div className="flex flex-wrap gap-2 p-4 bg-slate-950 border border-slate-800 rounded-2xl">
                    {editDraft.skills.map((skill, i) => (
                      <span key={i} className="px-3 py-1 bg-slate-800 text-slate-300 rounded-lg text-sm flex items-center gap-2 border border-slate-700">
                        {skill}
                        <button 
                          onClick={() => handleUpdateDraft('skills', editDraft.skills.filter(s => s !== skill))}
                          className="text-slate-500 hover:text-rose-400"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                    {editDraft.skills.length === 0 && <span className="text-slate-600 italic text-sm">No skills listed</span>}
                  </div>
                  <div className="relative mt-2">
                    <input 
                      type="text"
                      value={newSkillInModal}
                      onChange={(e) => setNewSkillInModal(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          if (newSkillInModal.trim()) {
                            handleUpdateDraft('skills', [...new Set([...editDraft.skills, newSkillInModal.trim()])]);
                            setNewSkillInModal('');
                          }
                        }
                      }}
                      placeholder="Add a skill and press Enter..."
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2 px-4 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-amber-500/50 transition-all pr-10"
                    />
                    <button 
                      type="button"
                      onClick={() => {
                        if (newSkillInModal.trim()) {
                          handleUpdateDraft('skills', [...new Set([...editDraft.skills, newSkillInModal.trim()])]);
                          setNewSkillInModal('');
                        }
                      }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-amber-500 hover:bg-amber-500/10 rounded-lg transition-all"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              <div className="p-8 bg-slate-950 border-t border-slate-800 flex items-center justify-end gap-4 shrink-0">
                <button 
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-6 py-3 text-sm font-bold text-slate-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleRefineSearch}
                  className="px-8 py-3 bg-amber-500 text-slate-900 rounded-2xl font-black text-sm hover:bg-amber-400 shadow-lg shadow-amber-500/10 transition-all active:scale-95"
                >
                  Refine Search
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Email Modal */}
      <AnimatePresence>
        {emailModalJob && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setEmailModalJob(null)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-[2rem] shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-slate-800">
                <h3 className="text-xl font-bold text-white">Send Application Email</h3>
                <p className="text-sm text-slate-500 mt-1">To: {emailModalJob.contactEmail}</p>
              </div>

              <div className="p-6 space-y-4">
                {[
                  { id: 'attachTailoredResume', label: 'Attach auto generated resume' },
                  { id: 'attachTailoredCoverLetter', label: 'Attach auto generated cover letter' },
                  { id: 'generateMailContent', label: 'Auto generate mail content' },
                  { id: 'attachUploadedResume', label: 'Attach uploaded resume' },
                ].map((option) => (
                  <label key={option.id} className="flex items-center gap-3 cursor-pointer group">
                    <div 
                      onClick={() => setEmailOptions(prev => ({ ...prev, [option.id]: !prev[option.id as keyof typeof prev] }))}
                      className={cn(
                        "w-5 h-5 rounded border flex items-center justify-center transition-all",
                        emailOptions[option.id as keyof typeof emailOptions] 
                          ? "bg-amber-500 border-amber-500" 
                          : "border-slate-700 bg-slate-800 group-hover:border-slate-600"
                      )}
                    >
                      {emailOptions[option.id as keyof typeof emailOptions] && <Check className="w-3 h-3 text-slate-900" />}
                    </div>
                    <span className="text-sm text-slate-300 group-hover:text-white transition-colors">{option.label}</span>
                  </label>
                ))}
              </div>

              <div className="p-6 bg-slate-950 border-t border-slate-800 flex items-center justify-end gap-3">
                <button 
                  onClick={() => setEmailModalJob(null)}
                  className="px-4 py-2 text-sm font-bold text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleSendMail}
                  disabled={isSendingMail}
                  className="px-6 py-2.5 bg-emerald-600 text-white rounded-xl font-bold text-sm hover:bg-emerald-500 transition-all flex items-center gap-2 disabled:opacity-50"
                >
                  {isSendingMail ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                  Send Mail
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Loading Overlay */}
      <AnimatePresence>
        {isAnalyzing && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-[#020617]/90 backdrop-blur-md z-50 flex flex-col items-center justify-center"
          >
            <div className="relative">
              <div className="w-24 h-24 rounded-full border-4 border-amber-500/20 border-t-amber-500 animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center">
                <FileText className="w-8 h-8 text-amber-500" />
              </div>
            </div>
            <h3 className="text-2xl font-black mt-8 text-white tracking-tight">Analyzing Resume...</h3>
            <p className="text-slate-400 mt-3 font-medium">Our AI is extracting your skills and experience.</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
