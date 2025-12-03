"""
Root Agent - Query Processing for Study Assistant

Uses Gemini 2.5 Flash with native PDF processing for optimal performance.
"""

from google import genai
from google.genai import types
from typing import List, Dict, AsyncGenerator, Optional
import asyncio
from utils.file_upload_manager import FileUploadManager
from agents.file_selector_agent import FileSelectorAgent, SelectionStage


class RootAgent:
    @staticmethod
    def strip_extension_for_matching(doc_id: str) -> str:
        """
        Strip file extension from document ID for fuzzy matching.

        This handles cases where files are converted during upload:
        - .pptx → .pdf
        - .xlsx → .pdf
        - .docx → .pdf

        Args:
            doc_id: Document ID like "1424277_filename.pptx"

        Returns:
            Document ID without extension like "1424277_filename"

        Example:
            "1424277_Lego Assignment V2.pptx" → "1424277_Lego Assignment V2"
            "1424277_Lego Assignment V2.pdf" → "1424277_Lego Assignment V2"
        """
        if '_' in doc_id:
            # Split into course_id and filename
            parts = doc_id.split('_', 1)
            if len(parts) == 2:
                course_id, filename = parts
                # Strip extension from filename
                if '.' in filename:
                    filename_no_ext = filename.rsplit('.', 1)[0]
                    return f"{course_id}_{filename_no_ext}"
        return doc_id

    def __init__(self, document_manager, google_api_key: str, storage_manager=None, chat_storage=None):
        """
        Initialize Root Agent with Gemini 2.5 Flash

        Args:
            document_manager: DocumentManager instance for document catalog
            google_api_key: Google API key for Gemini
            storage_manager: Optional StorageManager for GCS file access
            chat_storage: Optional ChatStorage for file summaries access
        """
        self.document_manager = document_manager
        self.storage_manager = storage_manager
        self.chat_storage = chat_storage

        # Initialize Gemini client
        self.client = genai.Client(api_key=google_api_key)
        self.model_id = "gemini-2.5-flash"

        # Initialize File Upload Manager
        self.file_upload_manager = FileUploadManager(
            self.client,
            cache_duration_hours=48,
            storage_manager=storage_manager
        )

        # Initialize File Selector Agent
        self.file_selector_agent = FileSelectorAgent(google_api_key=google_api_key)

        # Session tracking: {session_id: {doc_ids: set(), file_uris: list()}}
        self.session_uploads = {}

    def clear_session(self, session_id: str):
        """Clear uploaded files for a session"""
        if session_id in self.session_uploads:
            del self.session_uploads[session_id]
            print(f"🗑️  Cleared session: {session_id}")

    async def process_query_stream(
        self,
        course_id: str,
        user_message: str,
        conversation_history: List[Dict],
        selected_docs: List[str] = None,
        syllabus_id: str = None,
        session_id: str = None,
        enable_web_search: bool = False,
        user_api_key: str = None,
        use_smart_selection: bool = False,
        stop_check_callback = None
    ) -> AsyncGenerator[str, None]:
        """
        Process user query with streaming response

        Args:
            course_id: Course identifier
            user_message: User's question
            conversation_history: Previous conversation messages
            selected_docs: List of selected document IDs to process
            syllabus_id: Optional syllabus document ID (always included)
            session_id: WebSocket session ID for tracking uploads
            enable_web_search: Whether to enable Google Search grounding
            user_api_key: Optional user-provided Gemini API key (overrides default)
            use_smart_selection: Whether to use AI-powered intelligent file selection

        Yields:
            Response chunks
        """
        try:
            # Use user's API key if provided, otherwise use default
            api_client = self.client
            file_upload_manager = self.file_upload_manager

            if user_api_key:
                api_client = genai.Client(api_key=user_api_key)
                # Create new FileUploadManager with user's API key
                # Files must be uploaded with same key used for generation
                file_upload_manager = FileUploadManager(
                    api_client,
                    cache_duration_hours=48,
                    storage_manager=self.storage_manager
                )
                print(f"🔑 Using user-provided API key")

            print(f"\n{'='*80}")
            print(f"🔍 DEBUG: Starting query processing")
            print(f"   Course ID: {course_id}")
            print(f"   Session ID: {session_id}")
            print(f"   Web Search: {'Enabled' if enable_web_search else 'Disabled'}")
            print(f"   Smart Selection: {'Enabled' if use_smart_selection else 'Disabled'}")
            print(f"   Conversation history length: {len(conversation_history)}")

            # Step 1: Get all available documents
            catalog = self.document_manager.get_material_catalog(course_id)
            all_materials = catalog.get("materials", [])
            print(f"   📂 Total materials in catalog: {len(all_materials)}")

            if not all_materials:
                yield "No course materials found. Please upload PDFs first."
                return

            # Step 2: Filter based on selection (manual or AI-powered)
            materials_to_use = []

            # If smart selection is enabled, use AI to select relevant files
            if use_smart_selection and self.chat_storage:
                print(f"\n   🤖 SMART SELECTION ENABLED (ANCHOR CLUSTER PATTERN)")
                print(f"   ❓ User query: {user_message[:200]}{'...' if len(user_message) > 200 else ''}")

                # Get file summaries from database
                file_summaries = self.chat_storage.get_all_summaries_for_course(course_id)
                print(f"   📚 Found {len(file_summaries)} file summaries")

                if not file_summaries:
                    print(f"   ⚠️  No summaries available, falling back to manual selection")
                    yield "[STATUS]no_summaries|No file summaries available"
                    materials_to_use = all_materials
                else:
                    # CRITICAL: Always fetch syllabus for ground truth
                    print(f"   📚 Fetching syllabus for ground truth context...")

                    # Try to get stored syllabus_id from database first
                    if not syllabus_id and self.chat_storage:
                        syllabus_id = self.chat_storage.get_course_syllabus(course_id)
                        if syllabus_id:
                            print(f"      ✅ Found stored syllabus_id in database: {syllabus_id}")

                    syllabus_summary = None
                    if syllabus_id:
                        print(f"      Using syllabus_id: {syllabus_id}")
                        syllabus_summary = await self.file_selector_agent.get_syllabus_summary(
                            syllabus_id, file_summaries
                        )
                    else:
                        print(f"      No syllabus_id stored, searching for 'syllabus' in filenames...")
                        syllabus_summary = await self.file_selector_agent.get_syllabus_summary(
                            None, file_summaries
                        )

                    if syllabus_summary:
                        print(f"   ✅ Found syllabus ({len(syllabus_summary)} chars)")
                    else:
                        print(f"   ⚠️  No syllabus found - proceeding without course structure")

                    # Determine max_files based on user query or use default
                    import re
                    max_files = 15  # Default

                    # Check if user specifies a number in their query
                    number_patterns = [
                        r'at least (\d+)',
                        r'give me (\d+)',
                        r'(\d+) files',
                        r'(\d+) sources'
                    ]
                    for pattern in number_patterns:
                        match = re.search(pattern, user_message.lower())
                        if match:
                            requested = int(match.group(1))
                            max_files = min(requested, 30)  # Cap at 30 for performance
                            print(f"   📊 User requested {requested} files, using max_files={max_files}")
                            break

                    # Create asyncio queue for real-time status streaming
                    status_queue = asyncio.Queue()

                    def status_callback(stage: str, message: str, count: int = None):
                        """Push status messages to queue for real-time streaming"""
                        status_queue.put_nowait({
                            "stage": stage,
                            "message": message,
                            "count": count
                        })
                        print(f"   📊 Status: [{stage}] {message}" + (f" ({count})" if count else ""))

                    # Run file selection in background task
                    selection_task = asyncio.create_task(
                        self.file_selector_agent.select_relevant_files(
                            user_query=user_message,
                            file_summaries=file_summaries,
                            syllabus_summary=syllabus_summary,
                            syllabus_doc_id=syllabus_id,
                            selected_docs=selected_docs,
                            max_files=max_files,
                            status_callback=status_callback
                        )
                    )

                    # Stream status messages as they arrive
                    while not selection_task.done():
                        try:
                            # Wait for status message with short timeout
                            status = await asyncio.wait_for(status_queue.get(), timeout=0.1)
                            stage = status["stage"]
                            message = status["message"]
                            count = status.get("count")
                            count_str = f"|{count}" if count is not None else ""
                            yield f"[STATUS]{stage}|{message}{count_str}"
                        except asyncio.TimeoutError:
                            # No message yet, continue checking
                            continue

                    # Get the result
                    selected_files = await selection_task

                    # Drain any remaining status messages
                    while not status_queue.empty():
                        status = status_queue.get_nowait()
                        stage = status["stage"]
                        message = status["message"]
                        count = status.get("count")
                        count_str = f"|{count}" if count is not None else ""
                        yield f"[STATUS]{stage}|{message}{count_str}"

                    if not selected_files:
                        print(f"   ⚠️  File selector returned no files, using all materials")
                        yield "[STATUS]error|Could not determine relevant files"
                        materials_to_use = all_materials
                    else:
                        # Get the actual materials based on selected doc_ids
                        selected_doc_ids = [f.get("doc_id") for f in selected_files]
                        print(f"   🔍 DEBUG: Selected doc IDs from AI: {selected_doc_ids[:5]}...")
                        print(f"   🔍 DEBUG: Available material IDs: {[m['id'] for m in all_materials[:5]]}...")
                        materials_to_use = [m for m in all_materials if m["id"] in selected_doc_ids]
                        print(f"   🔍 DEBUG: Matched {len(materials_to_use)} materials from {len(selected_doc_ids)} selected IDs")

                        # Always include syllabus if available (unless already included)
                        if syllabus_id and syllabus_id not in selected_doc_ids:
                            syllabus = next((m for m in all_materials if m["id"] == syllabus_id), None)
                            if syllabus:
                                materials_to_use.append(syllabus)

                        # Yield final selection status
                        file_names = [f.get("filename", "unknown") for f in selected_files[:3]]
                        yield f"[STATUS]complete|Selected {len(materials_to_use)} files|{len(materials_to_use)}"

                        print(f"   ✅ Smart selection chose {len(materials_to_use)} files:")
                        for file in selected_files[:5]:
                            print(f"      📄 {file.get('filename')}")

            # Manual selection (original behavior)
            elif selected_docs:
                print(f"   📋 Using manual selection")
                print(f"   📋 Selected docs from client: {selected_docs}")
                print(f"   📋 Number of selected docs: {len(selected_docs)}")

                # Debug: Show all material IDs available
                available_ids = [m["id"] for m in all_materials]
                print(f"   🔑 Available material IDs ({len(available_ids)}):")
                for avail_id in available_ids[:10]:  # Show first 10
                    print(f"      - {avail_id}")

                print(f"\n   📋 Selected doc IDs from frontend ({len(selected_docs)}):")
                for sel_id in selected_docs[:10]:  # Show first 10
                    print(f"      - {sel_id}")

                # CRITICAL: Match with extension stripping to handle file conversions
                # Frontend sends: "1424277_file.pptx"
                # Catalog has: "1424277_file.pdf" (converted)
                # Solution: Strip extensions and match on basename

                # Build mapping: stripped_id → [full_catalog_ids]
                stripped_to_catalog = {}
                for material in all_materials:
                    stripped_id = self.strip_extension_for_matching(material["id"])
                    if stripped_id not in stripped_to_catalog:
                        stripped_to_catalog[stripped_id] = []
                    stripped_to_catalog[stripped_id].append(material)

                # Match selected docs using stripped comparison
                materials_to_use = []
                for selected_id in selected_docs:
                    stripped_selected = self.strip_extension_for_matching(selected_id)

                    # Check if we have a match (with or without extension)
                    if stripped_selected in stripped_to_catalog:
                        # Found match! Add the catalog version (which has correct extension)
                        matched_materials = stripped_to_catalog[stripped_selected]
                        materials_to_use.extend(matched_materials)

                        # Debug log if extensions differ
                        for mat in matched_materials:
                            if mat["id"] != selected_id:
                                print(f"   🔄 Extension mismatch resolved: '{selected_id}' → '{mat['id']}'")

                print(f"\n   ✅ Matched {len(materials_to_use)} materials from selection")

                if len(materials_to_use) < len(selected_docs):
                    print(f"   ⚠️  WARNING: {len(selected_docs) - len(materials_to_use)} selected docs not found in catalog!")
                    missing = set(selected_docs) - set(m["id"] for m in materials_to_use)
                    print(f"   ⚠️  Missing IDs:")
                    for miss_id in list(missing)[:10]:  # Show first 10
                        print(f"      - {miss_id}")

                    # Try to find close matches
                    print(f"\n   🔍 Looking for close matches:")
                    for miss_id in list(missing)[:5]:
                        print(f"      Missing: {miss_id}")
                        # Find IDs that contain part of this ID
                        for avail in available_ids:
                            if miss_id in avail or avail in miss_id or miss_id.replace(":", "").replace("/", "") in avail:
                                print(f"        → Possible match: {avail}")

                # Always include syllabus if provided and not already selected
                if syllabus_id and syllabus_id not in selected_docs:
                    syllabus = next((m for m in all_materials if m["id"] == syllabus_id), None)
                    if syllabus:
                        materials_to_use.append(syllabus)
                        print(f"   ⭐ Including syllabus: {syllabus['name']}")

            # No selection - act like regular Gemini (no files)
            else:
                print(f"   ℹ️  No docs selected and smart selection off - using no materials (regular Gemini mode)")
                materials_to_use = []

            # Allow empty materials when user wants regular Gemini mode (no selection + no smart select)
            if not materials_to_use:
                # Check if this was intentional (no selection + smart select off)
                if not use_smart_selection and not selected_docs:
                    print(f"   ℹ️  Using Gemini in chat-only mode (no files)")
                    # Skip to chat generation without files
                else:
                    print(f"   ❌ No materials to use after filtering!")
                    yield "No documents selected. Please select at least one document or enable Smart Selection."
                    return

            print(f"   📚 Final materials to use: {len(materials_to_use)} PDF files")
            if materials_to_use:
                print(f"   📚 Material names: {[m['name'][:30] for m in materials_to_use[:3]]}...")

            # Step 3: Upload files to Gemini (skip if no materials selected)
            need_upload = False
            uploaded_files = []

            if materials_to_use:
                selected_doc_ids = set([m["id"] for m in materials_to_use])
                session_cache = self.session_uploads.get(session_id, {})
                cached_doc_ids = session_cache.get("doc_ids", set())

                print(f"   🔍 Session check:")
                print(f"      Session ID: {session_id}")
                print(f"      Selected doc IDs ({len(selected_doc_ids)}): {list(selected_doc_ids)[:3]}...")
                print(f"      Cached doc IDs ({len(cached_doc_ids)}): {list(cached_doc_ids)[:3] if cached_doc_ids else 'None'}...")
                print(f"      IDs match: {cached_doc_ids == selected_doc_ids}")

                # Verify all materials have paths
                materials_with_paths = [m for m in materials_to_use if m.get("path")]
                if len(materials_with_paths) < len(materials_to_use):
                    print(f"   ⚠️  WARNING: {len(materials_to_use) - len(materials_with_paths)} materials missing paths!")
                    missing_path_materials = [m for m in materials_to_use if not m.get("path")]
                    for mat in missing_path_materials[:3]:
                        print(f"      - {mat.get('name', 'unknown')}: id={mat.get('id', 'unknown')}")

                print(f"   📂 Materials to upload: {len(materials_with_paths)} with valid paths")

                if session_id and cached_doc_ids == selected_doc_ids:
                    # Same files already uploaded in this session - reuse
                    print(f"   ✅ Reusing {len(materials_to_use)} files from session cache")
                    uploaded_files = session_cache.get("file_info", [])
                    print(f"   ✅ Retrieved {len(uploaded_files)} file URIs from cache")
                else:
                    # Need to upload (new session or different file selection)
                    need_upload = True
                    print(f"   📤 Uploading {len(materials_to_use)} files to Gemini...")

                    file_paths = [mat["path"] for mat in materials_to_use if mat.get("path")]
                    print(f"   📂 Files with paths: {len(file_paths)}/{len(materials_to_use)}")
                    print(f"   📂 Sample paths: {file_paths[:2]}...")

                    if not file_paths:
                        print(f"   ❌ ERROR: No valid file paths found!")
                        yield "❌ Error: No valid file paths found in materials. Please re-scan course materials.\n\n"
                        return

                    upload_result = await file_upload_manager.upload_multiple_pdfs_async(file_paths)

                    if not upload_result.get('success'):
                        error_msg = upload_result.get('error', 'Unknown error')
                        print(f"   ❌ Upload failed: {error_msg}")
                        yield f"❌ Error uploading files: {error_msg}"
                        return

                    uploaded_files = upload_result.get('files', [])
                    failed_files = upload_result.get('failed', [])
                    total_mb = upload_result['total_bytes'] / (1024 * 1024)

                    print(f"   ✅ Uploaded {len(uploaded_files)} files (~{total_mb:.1f}MB)")
                    if failed_files:
                        print(f"   ⚠️  Failed to upload {len(failed_files)} files:")
                        for failed in failed_files:
                            print(f"      - {failed.get('path', 'unknown')}: {failed.get('error', 'unknown error')}")
                    print(f"   ✅ File URIs: {[f['uri'][:50] + '...' for f in uploaded_files[:2]]}")

                    # Inform user if no files could be uploaded
                    if len(uploaded_files) == 0:
                        yield "⚠️ **No files could be uploaded to Gemini.**\n\n"
                        if failed_files:
                            yield f"**Failed uploads ({len(failed_files)} files):**\n"
                            for failed in failed_files[:5]:  # Show first 5
                                path = failed.get('path', 'unknown')
                                filename = path.split('/')[-1] if '/' in path else path
                                error = failed.get('error', 'unknown error')
                                yield f"- {filename}: {error}\n"
                            if len(failed_files) > 5:
                                yield f"- ... and {len(failed_files) - 5} more\n"
                        yield "\n**Supported formats**: PDF, TXT, MD, CSV, PNG, JPG, JPEG, GIF, WEBP\n"
                        yield "**Tip**: Convert PPTX, DOCX, XLSX files to PDF for best results\n\n"
                        return

                    # Cache for this session
                    if session_id:
                        self.session_uploads[session_id] = {
                            "doc_ids": selected_doc_ids,
                            "file_info": uploaded_files
                        }
                        print(f"   💾 Cached {len(uploaded_files)} files for session")

                    # Yield upload status to user
                    status_msg = f"📤 **Loaded {len(uploaded_files)} of {len(materials_to_use)} files** (~{total_mb:.1f}MB)"
                    if failed_files:
                        status_msg += f"\n⚠️ **{len(failed_files)} files could not be uploaded:**\n"
                        for failed in failed_files[:3]:  # Show first 3
                            path = failed.get('path', 'unknown')
                            filename = path.split('/')[-1] if '/' in path else path
                            error = failed.get('error', 'unknown error')
                            # Show short error message
                            short_error = error.split('.')[0] if '.' in error else error
                            status_msg += f"  - {filename}: {short_error}\n"
                        if len(failed_files) > 3:
                            status_msg += f"  - ... and {len(failed_files) - 3} more\n"
                    yield status_msg + "\n"

            # Step 4: Build system instruction
            file_names = [mat['name'] for mat in materials_to_use]

            # Build system instruction based on whether files are loaded
            if materials_to_use:
                # Build capabilities description
                capabilities_text = "1. Read uploaded documents (PDFs, Word docs, images, etc.) directly"
                if enable_web_search:
                    capabilities_text += "\n2. Perform Google searches for current information, news, or topics not in course materials"

                system_instruction = f"""You are an AI study assistant with access to {len(uploaded_files)} course documents{"and real-time web search" if enable_web_search else ""}.

Available course materials: {', '.join(file_names[:10])}{"..." if len(file_names) > 10 else ""}

CAPABILITIES:
{capabilities_text}

CITATION FORMAT:
When referencing information from course documents, use:
[Source: DocumentName, Page X]

Examples:
- According to the lecture notes [Source: Lecture_3_Algorithms, Page 12], sorting algorithms...
- The syllabus states [Source: CS101_Syllabus, Page 3] that exams are worth 40%.
{"When using web search results, the sources will be automatically cited below your response." if enable_web_search else ""}

FORMATTING GUIDELINES FOR MAXIMUM READABILITY:

1. **Multiple Choice Questions**: ALWAYS put each option on a separate line with clear spacing
   Example:
   **Question**: Which sorting algorithm has O(n log n) complexity?

   A) Bubble Sort
   B) Quick Sort
   C) Selection Sort
   D) Insertion Sort

2. **Matching Questions**: Use a two-column format with numbered terms and lettered definitions
   Example:
   **Match the following:**

   **Column A (Terms):**
   1. Algorithm
   2. Data Structure
   3. Recursion

   **Column B (Definitions):**
   A. A function that calls itself
   B. A step-by-step procedure for solving a problem
   C. A way of organizing and storing data

3. **Lists**: Use proper spacing between list items for complex content
   - Add blank lines between major list items
   - Use sub-bullets for nested information
   - Bold key terms within list items

4. **Tables**: Use markdown tables for structured comparisons, data, or side-by-side information
   Example:
   | Algorithm | Time Complexity | Space Complexity |
   |-----------|----------------|------------------|
   | Quick Sort | O(n log n) | O(log n) |
   | Merge Sort | O(n log n) | O(n) |

5. **Code Blocks**: Use triple backticks with language specification
   Example: ```python
   def example():
       return "formatted code"
   ```

6. **Mathematical Expressions**: Use LaTeX notation for formulas
   - Inline math: $E = mc^2$
   - Display math: $$\\int_0^\\infty e^{{-x^2}} dx$$

7. **Headings and Structure**: Use markdown headings (##, ###) to organize long responses
   - Break long answers into logical sections
   - Use bold (**text**) for emphasis on key concepts
   - Add spacing between major sections

8. **Study Questions/Practice Problems**: Number each question clearly and add spacing
   Example:
   **Practice Problems:**

   **1.** First question here

   **2.** Second question here

{"PRIORITY: Always prioritize course materials first. Use web search only when information is not available in course materials or when user asks about current events." if enable_web_search else "Focus on providing accurate information from the course materials."}"""
            else:
                # No files - regular Gemini mode
                system_instruction = f"""You are a helpful AI assistant{"with access to real-time web search" if enable_web_search else ""}.

{"CAPABILITIES:\n1. Answer questions on any topic\n2. Perform Google searches for current information, news, or topics when needed\n\nWhen using web search results, the sources will be automatically cited below your response." if enable_web_search else "Provide helpful, accurate, and conversational responses to user questions."}"""

            # Step 5: Build conversation with file references
            contents = []

            # Add conversation history (text only, no files)
            for msg in conversation_history[-4:]:
                role = "user" if msg["role"] == "user" else "model"
                contents.append(types.Content(role=role, parts=[types.Part(text=msg["content"])]))

            # Add current message
            parts = []

            # Always attach files when documents are selected (Gemini requires file references on every call)
            print(f"   📎 Attaching files to API call:")
            print(f"      materials_to_use: {len(materials_to_use)} files")
            print(f"      uploaded_files: {len(uploaded_files)} files successfully uploaded")
            if uploaded_files:
                # Attach PDF file URIs
                for i, file_info in enumerate(uploaded_files):
                    parts.append(types.Part(file_data=types.FileData(file_uri=file_info['uri'])))
                print(f"      ✅ Attached {len(uploaded_files)} file URIs to message")
                print(f"      Sample URIs:")
                for f in uploaded_files[:3]:
                    display_name = f.get('display_name', 'unknown')
                    uri = f['uri'][:60] + '...'
                    print(f"         - {display_name}: {uri}")
                if len(uploaded_files) > 3:
                    print(f"         ... and {len(uploaded_files) - 3} more")
            else:
                print(f"      ⚠️  WARNING: No uploaded_files to attach!")
                print(f"      This means NO FILES will be sent to the LLM!")

            # Add user question
            parts.append(types.Part(text=user_message))
            contents.append(types.Content(role="user", parts=parts))

            print(f"   📨 Message parts: {len(parts)} parts total (files + text)")
            print(f"   🤖 Calling Gemini API now...")
            print(f"      Model: {self.model_id}")
            print(f"      Contents length: {len(contents)}")
            print(f"      History messages: {len(conversation_history)}")

            # Step 6: Stream response from Gemini
            # Conditionally enable Google Search based on user preference
            config_params = {
                "system_instruction": system_instruction,
                "temperature": 0.7,
                "max_output_tokens": 16000,  # Increased from 8192 for more detailed answers
            }

            # Only add Google Search tool if enabled
            if enable_web_search:
                config_params["tools"] = [types.Tool(google_search=types.GoogleSearch())]
                print(f"   🌐 Google Search enabled for this query")

            config = types.GenerateContentConfig(**config_params)

            response_stream = await api_client.aio.models.generate_content_stream(
                model=self.model_id,
                contents=contents,
                config=config
            )

            # Step 7: Stream response chunks with grounding metadata
            total_generated = 0
            search_results_shown = False

            chunk_num = 0
            async for chunk in response_stream:
                chunk_num += 1
                # Check if user requested to stop
                if stop_check_callback:
                    should_stop = stop_check_callback()
                    if chunk_num % 5 == 0:  # Log every 5 chunks to avoid spam
                        print(f"   📊 Chunk {chunk_num}: stop_check = {should_stop}")
                    if should_stop:
                        print(f"   🛑 Stop requested at chunk {chunk_num}, breaking Gemini stream early")
                        break

                # Stream text response
                if chunk.text:
                    yield chunk.text
                    total_generated += len(chunk.text)

                # Handle grounding metadata (web search results)
                if hasattr(chunk, 'candidates') and chunk.candidates:
                    candidate = chunk.candidates[0]
                    if hasattr(candidate, 'grounding_metadata') and candidate.grounding_metadata:
                        metadata = candidate.grounding_metadata

                        # Display search results if available
                        if not search_results_shown and hasattr(metadata, 'search_entry_point'):
                            search_entry_point = metadata.search_entry_point
                            if hasattr(search_entry_point, 'rendered_content'):
                                print(f"   🔍 Web search performed")
                                search_results_shown = True

                        # Extract and yield grounding chunks (web sources)
                        if hasattr(metadata, 'grounding_chunks') and metadata.grounding_chunks:
                            sources = []
                            for gc in metadata.grounding_chunks:
                                if hasattr(gc, 'web') and gc.web:
                                    web = gc.web
                                    if hasattr(web, 'uri') and hasattr(web, 'title'):
                                        sources.append(f"- [{web.title}]({web.uri})")

                            if sources and not search_results_shown:
                                yield "\n\n**Web Sources:**\n" + "\n".join(sources[:5]) + "\n"
                                print(f"   🌐 Included {len(sources)} web sources")

            print(f"   ✅ Complete ({total_generated} chars generated)")

        except Exception as e:
            error_msg = f"Error processing query: {str(e)}"
            print(f"❌ {error_msg}")
            import traceback
            traceback.print_exc()
            yield f"\n\n*{error_msg}*"
