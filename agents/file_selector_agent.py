"""
File Selector Agent - Anchor Cluster Implementation
Intelligently selects course materials using a two-stage "Anchor Cluster" approach

Architecture:
- Phase 1: Context Establishment (analyze intent, identify anchors, expand context)
- Phase 2: Execution (Global Discovery or Scoped Refinement)
- Status callbacks for frontend progress updates
"""

from google import genai
from google.genai import types
from typing import List, Dict, Optional, Tuple, Callable, AsyncGenerator
import asyncio
import json
import logging
import re
from datetime import datetime

logger = logging.getLogger(__name__)

# Status stages for frontend progress indicator
class SelectionStage:
    ANALYZING_QUERY = "analyzing_query"
    SCANNING_SUMMARIES = "scanning_summaries"
    IDENTIFYING_ANCHORS = "identifying_anchors"
    EXTRACTING_CONTEXT = "extracting_context"
    SCORING_FILES = "scoring_files"
    SELECTING_FILES = "selecting_files"
    COMPLETE = "complete"


class FileSelectorAgent:
    """Selects relevant files using Anchor Cluster pattern with status callbacks"""

    def __init__(self, google_api_key: str):
        """
        Initialize File Selector Agent

        Args:
            google_api_key: Google API key for Gemini
        """
        self.client = genai.Client(api_key=google_api_key)
        self.model_id = "gemini-2.0-flash-lite"  # Lightweight, separate quota
        self.fallback_model = "gemini-2.0-flash-lite"  # Valid fallback model

    async def select_relevant_files(
        self,
        user_query: str,
        file_summaries: List[Dict],
        syllabus_summary: Optional[str] = None,
        syllabus_doc_id: Optional[str] = None,
        selected_docs: Optional[List[str]] = None,
        max_files: int = 15,
        status_callback: Optional[Callable[[str, str, Optional[int]], None]] = None
    ) -> List[Dict]:
        """
        Route to appropriate selection strategy based on user state

        Args:
            user_query: The user's question
            file_summaries: List of dicts with doc_id, filename, summary, topics, metadata
            syllabus_summary: Course syllabus summary text
            syllabus_doc_id: Document ID of syllabus
            selected_docs: List of doc_ids user manually selected (None = Global Discovery)
            max_files: Maximum files to return
            status_callback: Optional callback for status updates (stage, message, count)

        Returns:
            List of selected file dicts
        """
        try:
            print(f"\n   🎯 ANCHOR CLUSTER FILE SELECTOR")
            print(f"      Query: {user_query[:150]}...")
            print(f"      Available summaries: {len(file_summaries)}")
            print(f"      Manual selection: {len(selected_docs) if selected_docs else 0} files")

            if not file_summaries:
                print(f"      ❌ No file summaries available")
                return []

            # Limit file summaries to prevent prompt overflow
            MAX_FILES = 100
            if len(file_summaries) > MAX_FILES:
                logger.warning(f"⚠️  Limiting from {len(file_summaries)} to {MAX_FILES}")
                file_summaries = file_summaries[:MAX_FILES]

            # Route based on user state
            if not selected_docs or len(selected_docs) == 0:
                # Scenario 1: Global Discovery
                print(f"   🌍 SCENARIO 1: Global Discovery (no manual selection)")
                return await self.global_discovery(
                    user_query, file_summaries, syllabus_summary, max_files,
                    status_callback=status_callback
                )
            else:
                # Scenario 2: Scoped Refinement
                print(f"   🔍 SCENARIO 2: Scoped Refinement ({len(selected_docs)} files selected)")
                return await self.scoped_refinement(
                    user_query, file_summaries, syllabus_summary, syllabus_doc_id,
                    selected_docs, max_files,
                    status_callback=status_callback
                )

        except Exception as e:
            logger.error(f"Error in file selection: {e}")
            import traceback
            traceback.print_exc()
            return []

    async def global_discovery(
        self,
        user_query: str,
        file_summaries: List[Dict],
        syllabus_summary: Optional[str],
        max_files: int,
        status_callback: Optional[Callable[[str, str, Optional[int]], None]] = None
    ) -> List[Dict]:
        """
        Scenario 1: Global Discovery - SINGLE AI CALL for speed

        Uses one fast AI call to directly select relevant files from summaries.
        """
        try:
            print(f"\n   📍 GLOBAL DISCOVERY (Single-Call Fast Selection)")

            # Single AI call to select files directly
            if status_callback:
                status_callback(SelectionStage.ANALYZING_QUERY, "Analyzing your question...", None)
                await asyncio.sleep(0)

            selected = await self._fast_select_files(
                user_query, file_summaries, syllabus_summary, max_files, status_callback
            )

            if status_callback:
                status_callback(SelectionStage.COMPLETE, f"Selected {len(selected)} files", len(selected))
                await asyncio.sleep(0)

            print(f"   ✅ Selected {len(selected)} files")
            for f in selected[:5]:
                print(f"      📄 {f.get('filename')}")

            return selected

        except Exception as e:
            logger.error(f"Error in global discovery: {e}")
            import traceback
            traceback.print_exc()
            return []

    async def _fast_select_files(
        self,
        user_query: str,
        file_summaries: List[Dict],
        syllabus_summary: Optional[str],
        max_files: int,
        status_callback: Optional[Callable[[str, str, Optional[int]], None]] = None
    ) -> List[Dict]:
        """
        Single AI call to select relevant files - FAST version
        """
        if status_callback:
            status_callback(SelectionStage.SCANNING_SUMMARIES, f"Scanning {len(file_summaries)} files...", len(file_summaries))
            await asyncio.sleep(0)

        # Build compact file list for prompt
        file_list = []
        file_lookup = {}
        for i, f in enumerate(file_summaries):
            doc_id = f.get('doc_id', f'file_{i}')
            filename = f.get('filename', 'unknown')
            summary = f.get('summary', '')[:200]  # Truncate for speed
            topics = f.get('topics', [])
            if isinstance(topics, str):
                try:
                    topics = json.loads(topics)
                except:
                    topics = []
            topics_str = ', '.join(topics[:5]) if topics else ''

            file_list.append(f"[{i}] {filename}\n    Summary: {summary}\n    Topics: {topics_str}")
            file_lookup[i] = f

        files_text = "\n\n".join(file_list[:50])  # Limit to 50 files for speed

        if status_callback:
            status_callback(SelectionStage.IDENTIFYING_ANCHORS, "Identifying relevant files...", None)
            await asyncio.sleep(0)

        prompt = f"""You are a file selector for a study assistant. Select the most relevant files for this question.

QUESTION: {user_query}

{f"COURSE CONTEXT: {syllabus_summary[:500]}" if syllabus_summary else ""}

FILES:
{files_text}

Select up to {max_files} files most relevant to answering the question.
Return ONLY a JSON array of file indices, e.g.: [0, 3, 7, 12]
Prioritize files that directly address the topic. Include study guides/reviews if relevant.
Return ONLY the JSON array, nothing else."""

        try:
            response = await self.client.aio.models.generate_content(
                model=self.model_id,
                contents=prompt,
                config=types.GenerateContentConfig(
                    temperature=0.1,
                    max_output_tokens=200,
                )
            )

            if status_callback:
                status_callback(SelectionStage.SCORING_FILES, "Processing selection...", None)
                await asyncio.sleep(0)

            # Parse response
            text = response.text.strip()
            # Extract JSON array
            match = re.search(r'\[[\d,\s]+\]', text)
            if match:
                indices = json.loads(match.group())
                selected = []
                for idx in indices[:max_files]:
                    if idx in file_lookup:
                        selected.append(file_lookup[idx])
                return selected

            # Fallback: return first N files
            print(f"      ⚠️ Could not parse AI response, using fallback")
            return file_summaries[:max_files]

        except Exception as e:
            logger.error(f"AI selection failed: {e}")
            return file_summaries[:max_files]

    async def scoped_refinement(
        self,
        user_query: str,
        file_summaries: List[Dict],
        syllabus_summary: Optional[str],
        syllabus_doc_id: Optional[str],
        selected_docs: List[str],
        max_files: int,
        status_callback: Optional[Callable[[str, str, Optional[int]], None]] = None
    ) -> List[Dict]:
        """
        Scenario 2: Scoped Refinement - SIMPLIFIED for speed

        Just filters to user's selection and uses fast AI selection within that scope.
        """
        try:
            print(f"\n   🔬 SCOPED REFINEMENT (Fast Selection)")
            print(f"      User selected {len(selected_docs)} files")

            if status_callback:
                status_callback(SelectionStage.ANALYZING_QUERY, "Analyzing your question...", None)
                await asyncio.sleep(0)

            # Filter to user's selection
            selected_set = set(selected_docs)
            scoped_summaries = [f for f in file_summaries if f.get('doc_id') in selected_set]
            print(f"      Scoped to {len(scoped_summaries)} files")

            if not scoped_summaries:
                print(f"      ⚠️ No matching summaries found")
                return []

            # Use same fast selection on the scoped set
            selected = await self._fast_select_files(
                user_query, scoped_summaries, syllabus_summary, max_files, status_callback
            )

            if status_callback:
                status_callback(SelectionStage.COMPLETE, f"Selected {len(selected)} files", len(selected))
                await asyncio.sleep(0)

            print(f"   ✅ Selected {len(selected)} of {len(selected_docs)} files")
            for f in selected[:5]:
                print(f"      📄 {f.get('filename')}")

            return selected

        except Exception as e:
            logger.error(f"Error in scoped refinement: {e}")
            import traceback
            traceback.print_exc()
            return []

    async def _analyze_query_intent(
        self,
        user_query: str,
        syllabus_summary: Optional[str]
    ) -> Dict:
        """
        AI analyzes user query to understand intent

        Returns:
            Dict with main_topic, query_type, scope, context_hints
        """
        try:
            syllabus_context = ""
            if syllabus_summary:
                syllabus_context = f"\n**Course Syllabus Context:**\n{syllabus_summary[:800]}...\n"

            prompt = f"""Analyze this student's query to understand their intent and needs.

**Student Query:**
{user_query}
{syllabus_context}

**Task:**
Analyze the query and extract:
1. **main_topic**: The primary subject/concept being asked about
2. **query_type**: The type of query - choose one:
   - "exam_prep": Preparing for an exam/test/quiz
   - "assignment_help": Working on homework/project/assignment
   - "conceptual": Understanding concepts/theories
   - "logistics": Course logistics (dates, policies, requirements)
   - "general": General question about course content
3. **scope**: Level of detail needed - choose one:
   - "overview": High-level understanding needed
   - "detailed": In-depth explanation needed
   - "specific": Specific answer to narrow question
4. **context_hints**: List of 5-10 related keywords, concepts, or topics that would be relevant

Return ONLY valid JSON in this format:
{{
  "main_topic": "string",
  "query_type": "exam_prep|assignment_help|conceptual|logistics|general",
  "scope": "overview|detailed|specific",
  "context_hints": ["keyword1", "keyword2", ...]
}}"""

            response = await self._call_ai_with_fallback(prompt, max_tokens=500)
            if not response:
                return {
                    'main_topic': user_query[:100],
                    'query_type': 'general',
                    'scope': 'detailed',
                    'context_hints': []
                }

            # Parse JSON
            response_text = response.strip()
            if response_text.startswith("```json"):
                response_text = response_text.split("```json")[1].split("```")[0]
            elif response_text.startswith("```"):
                response_text = response_text.split("```")[1].split("```")[0]

            intent = json.loads(response_text.strip())
            return intent

        except Exception as e:
            logger.error(f"Error analyzing query intent: {e}")
            return {
                'main_topic': user_query[:100],
                'query_type': 'general',
                'scope': 'detailed',
                'context_hints': []
            }

    async def _identify_anchors_ai(
        self,
        query_intent: Dict,
        file_summaries: List[Dict],
        syllabus_summary: Optional[str],
        max_anchors: int = 5
    ) -> List[Dict]:
        """
        AI identifies most authoritative/useful anchor files based on query intent
        """
        try:
            if not file_summaries:
                return []

            # Build files context
            files_context = self._build_files_context(file_summaries)

            # Build syllabus context
            syllabus_context = ""
            if syllabus_summary:
                syllabus_context = f"\n**Course Syllabus:**\n{syllabus_summary[:600]}...\n"

            prompt = f"""Select 3-5 "anchor" files that would be most useful for answering the student's query.

**Query Analysis:**
- Main Topic: {query_intent.get('main_topic')}
- Query Type: {query_intent.get('query_type')}
- Scope: {query_intent.get('scope')}
- Context Hints: {', '.join(query_intent.get('context_hints', [])[:10])}
{syllabus_context}

**Available Files:**
{files_context}

**Task:**
Identify {max_anchors} "anchor" files that would provide the MOST useful context. Prioritize files that:
1. **Provide structure/overview** (syllabus, module overviews, outlines, study guides)
2. **Define scope** (rubrics, review sheets, exam guides, assignment descriptions)
3. **Are comprehensive** on the main topic (lectures, textbook chapters covering the topic)
4. **Match the specific assessment** if query is about exam/assignment (e.g., "Exam 1 Study Guide" for Exam 1 questions)

Return ONLY valid JSON array of doc_ids with reasoning:
[
  {{
    "doc_id": "string",
    "filename": "string",
    "reasoning": "why this is a good anchor (1 sentence)"
  }},
  ...
]

Select up to {max_anchors} files. Return ONLY the JSON array."""

            response = await self._call_ai_with_fallback(prompt, max_tokens=1000)
            if not response:
                return []

            # Parse JSON
            response_text = response.strip()
            if response_text.startswith("```json"):
                response_text = response_text.split("```json")[1].split("```")[0]
            elif response_text.startswith("```"):
                response_text = response_text.split("```")[1].split("```")[0]

            selected_anchors = json.loads(response_text.strip())

            # Map back to full file objects
            anchor_files = []
            selected_doc_ids = [a.get('doc_id') for a in selected_anchors if isinstance(a, dict)]

            for file_info in file_summaries:
                if file_info.get('doc_id') in selected_doc_ids:
                    reasoning = next(
                        (a.get('reasoning', '') for a in selected_anchors if a.get('doc_id') == file_info.get('doc_id')),
                        ''
                    )
                    file_info['_anchor_reasoning'] = reasoning
                    file_info['_anchor_score'] = 1.0
                    anchor_files.append(file_info)

            return anchor_files[:max_anchors]

        except Exception as e:
            logger.error(f"Error identifying AI anchors: {e}")
            import traceback
            traceback.print_exc()
            return []

    def _identify_anchor_files(
        self,
        file_summaries: List[Dict],
        date_range: Optional[str] = None,
        scope: str = 'global'
    ) -> List[Dict]:
        """
        Fallback: Legacy heuristic-based anchor identification
        """
        anchor_keywords = [
            'study guide', 'review', 'recap', 'rubric', 'study_guide',
            'exam review', 'test review', 'practice', 'summary', 'overview',
            'syllabus', 'outline'
        ]

        anchors = []
        for file_info in file_summaries:
            filename = file_info.get('filename', '').lower()
            if any(keyword in filename for keyword in anchor_keywords):
                file_info['_anchor_score'] = 1.0
                anchors.append(file_info)

        anchors.sort(key=lambda x: x.get('_anchor_score', 0), reverse=True)
        return anchors[:5]

    async def _extract_anchor_keywords(
        self,
        anchor_files: List[Dict],
        user_query: str
    ) -> List[str]:
        """
        Extract specific keywords/concepts from anchor file summaries
        """
        try:
            if not anchor_files:
                return []

            # Build context from anchor summaries
            anchor_context = ""
            for idx, anchor in enumerate(anchor_files[:5], 1):
                filename = anchor.get('filename', 'Unknown')
                summary = anchor.get('summary', '')
                topics = anchor.get('topics', [])

                if isinstance(topics, str):
                    try:
                        topics = json.loads(topics)
                    except:
                        topics = []

                topics_str = ", ".join(topics[:5]) if topics else "N/A"

                anchor_context += f"{idx}. **{filename}**\n"
                anchor_context += f"   Topics: {topics_str}\n"
                anchor_context += f"   Summary: {summary[:300]}...\n\n"

            prompt = f"""Extract specific keywords and concepts from these high-authority course materials (study guides, review sheets).

**Student Query Context:**
{user_query}

**Anchor Materials:**
{anchor_context}

**Task:**
Extract 10-20 specific keywords, concepts, theories, formulas, or terms that appear in these materials and are relevant to the query.

**Response Format:**
Return ONLY a JSON array of keywords:
["keyword1", "keyword2", "keyword3", ...]

Examples of good keywords:
- Specific theories: "Sociobiology", "Natural Selection"
- Formulas: "F=ma", "PV=nRT"
- Concepts: "operant conditioning", "market equilibrium"
- Specific terms: "mitochondria", "GDP deflator"

Return ONLY the JSON array, no other text."""

            response = await self._call_ai_with_fallback(prompt, max_tokens=500)
            if not response:
                return []

            response_text = response.strip()
            if response_text.startswith("```json"):
                response_text = response_text.split("```json")[1].split("```")[0]
            elif response_text.startswith("```"):
                response_text = response_text.split("```")[1].split("```")[0]

            keywords = json.loads(response_text.strip())
            return keywords if isinstance(keywords, list) else []

        except Exception as e:
            logger.error(f"Error extracting anchor keywords: {e}")
            # Fallback: extract topics from anchor files
            keywords = []
            for anchor in anchor_files[:3]:
                topics = anchor.get('topics', [])
                if isinstance(topics, str):
                    try:
                        topics = json.loads(topics)
                    except:
                        topics = []
                keywords.extend(topics)
            return keywords[:20]

    async def _score_files_with_anchors(
        self,
        file_summaries: List[Dict],
        user_query: str,
        anchor_keywords: List[str],
        syllabus_topics: List[str]
    ) -> List[Dict]:
        """
        Score files based on anchor keywords (2x weight) and query relevance
        """
        try:
            anchor_keywords_str = ", ".join(anchor_keywords[:15]) if anchor_keywords else "N/A"
            syllabus_topics_str = ", ".join(syllabus_topics[:10]) if syllabus_topics else "N/A"

            files_context = self._build_files_context(file_summaries)

            prompt = f"""Score the relevance of each file based on the user's query and extracted context.

**User Query:**
{user_query}

**High-Priority Keywords** (from study guides/review materials - 2x weight):
{anchor_keywords_str}

**Syllabus Topics:**
{syllabus_topics_str}

**Files to Score:**
{files_context}

**Scoring Criteria (in order of importance):**
1. HIGH (0.9-1.0): File directly covers anchor keywords (study guide concepts) - 2x priority
2. MEDIUM (0.6-0.8): File covers syllabus topics relevant to query
3. STANDARD (0.3-0.5): File relates to user query but not high-priority keywords
4. LOW (0.1-0.2): File has minimal relevance
5. IRRELEVANT (0.0): File is completely off-topic

**Date Validation:** Penalize files that appear to be from a different time period than what the query asks about.

**Task:**
Return a JSON object mapping doc_id to relevance score (0.0 to 1.0):
{{
  "doc_id_1": 0.9,
  "doc_id_2": 0.7,
  "doc_id_3": 0.4,
  ...
}}

Return ONLY the JSON, no other text."""

            response = await self._call_ai_with_fallback(prompt, max_tokens=2000)
            if not response:
                return file_summaries

            response_text = response.strip()
            if response_text.startswith("```json"):
                response_text = response_text.split("```json")[1].split("```")[0]
            elif response_text.startswith("```"):
                response_text = response_text.split("```")[1].split("```")[0]

            scores = json.loads(response_text.strip())

            for file_info in file_summaries:
                doc_id = file_info.get('doc_id')
                file_info['_score'] = scores.get(doc_id, 0.0)

            file_summaries.sort(key=lambda x: x.get('_score', 0), reverse=True)

            return file_summaries

        except Exception as e:
            logger.error(f"Error scoring files: {e}")
            return file_summaries

    async def _call_ai_with_fallback(
        self,
        prompt: str,
        max_tokens: int = 1000,
        temperature: float = 0.2
    ) -> Optional[str]:
        """Call AI with fallback to secondary model on rate limit"""
        try:
            response = self.client.models.generate_content(
                model=self.model_id,
                contents=prompt,
                config=types.GenerateContentConfig(
                    temperature=temperature,
                    max_output_tokens=max_tokens,
                )
            )

            if not response or not response.text:
                return None

            return response.text.strip()

        except Exception as api_error:
            error_str = str(api_error).lower()
            if '429' in error_str or 'quota' in error_str or 'rate' in error_str:
                logger.warning(f"⚠️ Rate limited, trying fallback model")
                try:
                    response = self.client.models.generate_content(
                        model=self.fallback_model,
                        contents=prompt,
                        config=types.GenerateContentConfig(
                            temperature=temperature,
                            max_output_tokens=max_tokens,
                        )
                    )
                    return response.text.strip() if response and response.text else None
                except:
                    return None
            return None

    def _build_files_context(self, file_summaries: List[Dict]) -> str:
        """Build formatted string of file summaries"""
        context_lines = []

        for idx, file_info in enumerate(file_summaries, 1):
            doc_id = file_info.get("doc_id", "unknown")
            filename = file_info.get("filename", "unknown")
            summary = file_info.get("summary", "")
            topics = file_info.get("topics", [])
            metadata = file_info.get("metadata", {})

            # Parse topics if string
            if isinstance(topics, str):
                try:
                    topics = json.loads(topics)
                except:
                    topics = []

            # Parse metadata if string
            if isinstance(metadata, str):
                try:
                    metadata = json.loads(metadata)
                except:
                    metadata = {}

            topics_str = ", ".join(topics[:5]) if topics else "N/A"
            time_refs = metadata.get("time_references", "")
            truncated_summary = summary[:150] + '...' if len(summary) > 150 else summary

            context_lines.append(
                f"{idx}. **{filename}**\n"
                f"   - ID: {doc_id}\n"
                f"   - Topics: {topics_str}\n"
                f"   - Time: {time_refs if time_refs else 'N/A'}\n"
                f"   - Summary: {truncated_summary}\n"
            )

        return "\n".join(context_lines)

    async def get_syllabus_summary(
        self,
        syllabus_doc_id: Optional[str],
        file_summaries: List[Dict]
    ) -> Optional[str]:
        """
        Extract syllabus summary if available

        Args:
            syllabus_doc_id: Document ID of syllabus (can be None)
            file_summaries: All file summaries

        Returns:
            Syllabus summary text or None
        """
        # Try exact match by doc_id
        if syllabus_doc_id:
            for file_info in file_summaries:
                if file_info.get("doc_id") == syllabus_doc_id:
                    print(f"      ✅ Found syllabus by ID: {file_info.get('filename')}")
                    return file_info.get("summary", "")

        # Search by filename
        print(f"      🔍 Searching for syllabus in {len(file_summaries)} files...")
        for file_info in file_summaries:
            filename = file_info.get("filename", "").lower()
            if "syllabus" in filename:
                print(f"      ✅ Found syllabus by filename: {file_info.get('filename')}")
                return file_info.get("summary", "")

        print(f"      ❌ No syllabus found")
        return None
