import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import { log } from './logger';
import { Task, TaskStatus } from './types';
// Optional import to prevent blocking extension load
let MCPClientClass: any = null;

async function loadMCPClient() {
    if (!MCPClientClass) {
        try {
            const mcpModule = await import('./mcpClient');
            MCPClientClass = mcpModule.MCPClient;
        } catch (error) {
            throw new Error(`Failed to load MCP client: ${error}`);
        }
    }
    return MCPClientClass;
}
import { TagManager } from './tagManager';

const execAsync = promisify(exec);

export class TaskMasterClient {
    private taskmasterPath: string;
    private tasksPath: string;
    private configPath: string;
    private mcpClient: any | null = null;
    private tagManager: TagManager;
    private taskMasterInstalled: boolean | null = null; // Cache installation status
    private cliVersion: string | null = null; // Cache CLI version
    private mcpVersion: string | null = null; // Cache MCP version
    private versionCheckTimestamp: number = 0; // Track when version was last checked

    constructor(taskmasterPath: string) {
        this.taskmasterPath = taskmasterPath;
        this.tasksPath = path.join(taskmasterPath, 'tasks');
        this.configPath = path.join(taskmasterPath, 'config.json');
        this.tagManager = new TagManager(taskmasterPath);
        log(`TaskMasterClient initialized for path: ${taskmasterPath}`);
    }

    private async getMCPClient(): Promise<any> {
        if (!this.mcpClient) {
            try {
                const MCPClientClass = await loadMCPClient();
                // Pass the parent directory of .taskmaster as project root
                const projectRoot = path.dirname(this.taskmasterPath);
                this.mcpClient = new MCPClientClass(projectRoot);
            } catch (error) {
                log(`Failed to create MCP client: ${error}`);
                throw new Error('MCP client unavailable');
            }
        }
        return this.mcpClient;
    }

    /**
     * Check if MCP functionality is available
     */
    async isMCPAvailable(): Promise<boolean> {
        try {
            const mcpClient = await this.getMCPClient();
            return await mcpClient.canLoadMCP();
        } catch (error) {
            log(`MCP not available: ${error}`);
            return false;
        }
    }

    // Map Task Master status values to extension status values
    private normalizeStatus(status: string): TaskStatus {
        const statusMap: { [key: string]: TaskStatus } = {
            'pending': 'todo',
            'todo': 'todo',
            'in-progress': 'in-progress',
            'in_progress': 'in-progress',
            'completed': 'completed',
            'done': 'completed',
            'blocked': 'blocked',
            'deferred': 'deferred',
            'cancelled': 'cancelled',
            'review': 'review'
        };
        return statusMap[status] || 'todo';
    }

    // Map extension status values back to Task Master status values
    private denormalizeStatus(status: TaskStatus): string {
        const statusMap: { [key: string]: string } = {
            'todo': 'pending',
            'in-progress': 'in-progress',
            'completed': 'done',
            'blocked': 'blocked',
            'deferred': 'deferred',
            'cancelled': 'cancelled',
            'review': 'review'
        };
        return statusMap[status] || status;
    }

    async getTasks(): Promise<Task[]> {
        try {
            // Check version compatibility first
            const versionCheck = await this.checkVersionCompatibility();
            if (!versionCheck.compatible && versionCheck.warning) {
                log(`⚠️  VERSION COMPATIBILITY ISSUE: ${versionCheck.warning}`);
                this.showVersionWarningToUser(versionCheck);
            }

            // Log version information for debugging
            this.logVersionDetails(versionCheck);

            // Determine if we should skip MCP due to version mismatch
            const shouldSkipMCP = !versionCheck.compatible && 
                                  this.shouldPreferCLIOnVersionMismatch() &&
                                  versionCheck.cliVersion !== null;

            if (shouldSkipMCP) {
                log(`🔄 FALLBACK: Skipping MCP due to version mismatch and user preference for CLI (CLI: ${versionCheck.cliVersion}, MCP: ${versionCheck.mcpVersion})`);
            }

            // Try MCP client first if available, compatible, and not skipped
            if (!shouldSkipMCP && await this.isMCPServerAvailable()) {
                try {
                    const currentTag = this.tagManager.getCurrentTag();
                    log(`Using MCP client to get tasks for tag: ${currentTag}`);
                    const mcpClient = await this.getMCPClient();
                    const mcpTasks = await mcpClient.getTasks(currentTag);
                    
                    // Validate MCP response
                    const validatedTasks = this.validateTasksResponse(mcpTasks, 'MCP');
                    if (validatedTasks) {
                        this.logOperationResult('getTasks', 'MCP', true, `Retrieved ${validatedTasks.length} tasks`);
                        return validatedTasks;
                    }
                    
                    this.logOperationResult('getTasks', 'MCP', false, 'Task validation failed');
                } catch (error) {
                    this.logOperationResult('getTasks', 'MCP', false, `${error}`);
                }
            }

            // Fallback to reading from tasks.json (supports multiple formats)
            const tasksJsonPath = path.join(this.tasksPath, 'tasks.json');
            if (fs.existsSync(tasksJsonPath)) {
                log(`Found tasks.json at ${tasksJsonPath}. Reading...`);
                const tasksData = fs.readFileSync(tasksJsonPath, 'utf8');
                const parsed = JSON.parse(tasksData);
                
                let rawTasks: any[] = [];
                
                // Handle different task.json formats
                if (Array.isArray(parsed)) {
                    // Format 1: Direct array format [task1, task2, ...]
                    rawTasks = parsed;
                    log(`Detected direct array format with ${rawTasks.length} tasks.`);
                } else if (parsed.master && parsed.master.tasks && Array.isArray(parsed.master.tasks)) {
                    // Format 2: New tagged format (v0.17.0+) - Direct tag format { master: { tasks: [...] }, ... }
                    log(`Detected new tagged format (v0.17.0+) - direct tag format.`);
                    
                    // Get current tag from state or default to 'master'
                    let currentTag = 'master';
                    try {
                        const statePath = path.join(this.taskmasterPath, 'state.json');
                        if (fs.existsSync(statePath)) {
                            const stateData = JSON.parse(fs.readFileSync(statePath, 'utf8'));
                            currentTag = stateData.currentTag || 'master';
                        }
                    } catch (error) {
                        log(`Could not read state.json, defaulting to 'master' tag: ${error}`);
                    }
                    
                    // Extract tasks from the current tag
                    const tagData = parsed[currentTag];
                    if (tagData && tagData.tasks && Array.isArray(tagData.tasks)) {
                        rawTasks = tagData.tasks;
                        log(`Using tag '${currentTag}' with ${rawTasks.length} tasks.`);
                    } else {
                        // Fallback to master tag if current tag doesn't exist or has no tasks
                        const masterData = parsed.master;
                        if (masterData && masterData.tasks && Array.isArray(masterData.tasks)) {
                            rawTasks = masterData.tasks;
                            log(`Current tag '${currentTag}' not found or empty, falling back to 'master' tag with ${rawTasks.length} tasks.`);
                        } else {
                            log(`No tasks found in tag '${currentTag}' or 'master' tag.`);
                            rawTasks = [];
                        }
                    }
                } else if (parsed.tags && typeof parsed.tags === 'object') {
                    // Format 3: New tagged format (v0.17.0+) - Nested tag format { tags: { master: { tasks: [...] }, ... } }
                    log(`Detected new tagged format (v0.17.0+) - nested tag format.`);
                    
                    // Get current tag from state or default to 'master'
                    let currentTag = 'master';
                    try {
                        const statePath = path.join(this.taskmasterPath, 'state.json');
                        if (fs.existsSync(statePath)) {
                            const stateData = JSON.parse(fs.readFileSync(statePath, 'utf8'));
                            currentTag = stateData.currentTag || 'master';
                        }
                    } catch (error) {
                        log(`Could not read state.json, defaulting to 'master' tag: ${error}`);
                    }
                    
                    // Extract tasks from the current tag
                    const tagData = parsed.tags[currentTag];
                    if (tagData && tagData.tasks && Array.isArray(tagData.tasks)) {
                        rawTasks = tagData.tasks;
                        log(`Using tag '${currentTag}' with ${rawTasks.length} tasks.`);
                    } else {
                        // Fallback to master tag if current tag doesn't exist or has no tasks
                        const masterData = parsed.tags.master;
                        if (masterData && masterData.tasks && Array.isArray(masterData.tasks)) {
                            rawTasks = masterData.tasks;
                            log(`Current tag '${currentTag}' not found or empty, falling back to 'master' tag with ${rawTasks.length} tasks.`);
                        } else {
                            log(`No tasks found in tag '${currentTag}' or 'master' tag.`);
                            rawTasks = [];
                        }
                    }
                } else if (parsed.tasks && Array.isArray(parsed.tasks)) {
                    // Format 4: Legacy format { tasks: [...] }
                    rawTasks = parsed.tasks;
                    log(`Detected legacy format with ${rawTasks.length} tasks.`);
                } else {
                    // Unknown format
                    log(`Unknown tasks.json format. Expected array, tagged format, or legacy format.`);
                    rawTasks = [];
                }
                
                log(`Parsed ${rawTasks.length} raw tasks from tasks.json.`);
                
                // Normalize status values and ensure proper structure
                const normalizedTasks = rawTasks
                    .filter((task: any) => task.id !== null && task.id !== undefined) // Filter out tasks without IDs
                    .map((task: any) => ({
                        ...task,
                        id: task.id.toString(), // Ensure ID is string
                        status: this.normalizeStatus(task.status || 'pending'),
                        subtasks: task.subtasks ? task.subtasks
                            .filter((subtask: any) => subtask.id !== null && subtask.id !== undefined) // Filter out subtasks without IDs
                            .map((subtask: any) => ({
                                ...subtask,
                                id: subtask.id.toString(),
                                status: this.normalizeStatus(subtask.status || 'pending')
                            })) : []
                    }));
                
                // Process hierarchy for dot-notation task IDs (e.g., 1.2.3)
                return this.processTaskHierarchy(normalizedTasks);
            }
            log(`tasks.json not found at ${tasksJsonPath}. Falling back to individual files.`);

            // Fall back to reading individual task files
            if (!fs.existsSync(this.tasksPath)) {
                log(`Tasks path ${this.tasksPath} does not exist. Returning empty array.`);
                return [];
            }

            const taskFiles = fs.readdirSync(this.tasksPath)
                .filter(file => {
                    // Only read individual task files that follow the pattern task_XXX.json or XXX.json (where XXX is a number)
                    // Exclude the main tasks.json and any other arbitrary JSON files
                    if (file === 'tasks.json') {
                        return false;
                    }
                    if (file.endsWith('.json')) {
                        const baseName = file.replace('.json', '');
                        // Allow task_XXX.json pattern or pure number.json pattern
                        return /^(task_)?\d+$/.test(baseName);
                    }
                    return false;
                })
                .sort();
            
            log(`Found ${taskFiles.length} individual task files.`);

            const tasks: Task[] = [];
            for (const file of taskFiles) {
                try {
                    const taskPath = path.join(this.tasksPath, file);
                    const taskData = fs.readFileSync(taskPath, 'utf8');
                    const task = JSON.parse(taskData);
                    
                    // Ensure task has required fields
                    if (task.id && task.title) {
                        tasks.push({
                            status: this.normalizeStatus(task.status || 'pending'),
                            ...task,
                            id: task.id.toString(),
                            subtasks: task.subtasks ? task.subtasks.map((subtask: any) => ({
                                ...subtask,
                                id: subtask.id.toString(),
                                status: this.normalizeStatus(subtask.status || 'pending')
                            })) : []
                        });
                    }
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    log(`Error reading task file ${file}: ${errorMessage}`);
                }
            }

            // Process hierarchy for dot-notation task IDs (e.g., 1.2.3)
            return this.processTaskHierarchy(tasks);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log(`Error reading tasks: ${errorMessage}`);
            return [];
        }
    }

    /**
     * Process task hierarchy to organize tasks with dot notation IDs (1.2.3) into proper parent-child relationships
     * Supports arbitrary nesting levels and properly handles deep hierarchies
     */
    private processTaskHierarchy(tasks: Task[]): Task[] {
        log(`Processing task hierarchy for ${tasks.length} tasks.`);
        // Check if we already have properly structured subtasks in the data
        const hasExistingSubtasks = tasks.some(task => task.subtasks && task.subtasks.length > 0);
        
        // If tasks already have subtasks, they're properly structured - don't reorganize
        if (hasExistingSubtasks) {
            log('Tasks already have subtask arrays. Skipping hierarchy processing.');
            return tasks;
        }
        
        // Check if there are any tasks with dot notation IDs that need reorganization
        const hasDotNotationTasks = tasks.some(task => task.id?.toString().includes('.'));
        
        // If no dot notation tasks exist, return tasks as-is (already properly structured)
        if (!hasDotNotationTasks) {
            log('No dot-notation tasks found. Skipping hierarchy processing.');
            return tasks;
        }
        
        const taskMap = new Map<string, Task>();
        const rootTasks: Task[] = [];
        
        // First pass: create a map of all tasks and preserve existing subtasks
        tasks.forEach(task => {
            taskMap.set(task.id, { ...task, subtasks: task.subtasks || [] });
        });
        log(`Created task map with ${taskMap.size} tasks.`);
        
        // Sort task IDs to ensure parents are processed before children
        const sortedTaskIds = Array.from(taskMap.keys()).sort((a, b) => {
            // Sort by depth first (number of dots), then by natural order
            const depthA = (a.match(/\./g) || []).length;
            const depthB = (b.match(/\./g) || []).length;
            
            if (depthA !== depthB) {
                return depthA - depthB;
            }
            
            return a.localeCompare(b, undefined, { numeric: true });
        });
        
        // Second pass: organize into hierarchy
        sortedTaskIds.forEach(taskId => {
            const task = taskMap.get(taskId)!;
            
            if (taskId.includes('.')) {
                // This is a subtask - find its parent
                const parentId = this.getParentId(taskId);
                const parent = taskMap.get(parentId);
                
                if (parent && parent.subtasks) {
                    // Add to parent's subtasks
                    parent.subtasks.push(task);
                    // Set parentId for reference
                    task.parentId = parentId;
                } else {
                    // Parent not found, treat as root task (fallback)
                    log(`Parent task ${parentId} not found for subtask ${taskId}. Treating as root.`);
                    rootTasks.push(task);
                }
            } else {
                // This is a root task
                rootTasks.push(task);
            }
        });
        
        log(`Finished processing hierarchy. Found ${rootTasks.length} root tasks.`);
        return rootTasks;
    }
    
    /**
     * Get the parent ID for a task ID with dot notation
     * Examples: 
     * - "1.2" -> "1"
     * - "1.2.3" -> "1.2"
     * - "1.2.3.4" -> "1.2.3"
     */
    private getParentId(taskId: string): string {
        const lastDotIndex = taskId.lastIndexOf('.');
        return taskId.substring(0, lastDotIndex);
    }
    
    /**
     * Calculate the nesting level of a task based on its ID
     * Examples:
     * - "1" -> 0 (root level)
     * - "1.2" -> 1 (first level subtask)
     * - "1.2.3" -> 2 (second level subtask)
     */
    public getNestingLevel(taskId: string): number {
        return (taskId.match(/\./g) || []).length;
    }

    /**
     * Helper method to extract tasks from any format and return format info
     * Supports legacy, direct array, and new tagged formats
     */
    private extractTasksFromContainer(tasksContainer: any): {
        tasks: any[];
        isTaggedFormat: boolean;
        currentTag: string;
        originalContainer: any;
    } {
        let tasks: any[] = [];
        let isTaggedFormat = false;
        let currentTag = 'master';
        
        if (Array.isArray(tasksContainer)) {
            // Direct array format
            tasks = tasksContainer;
        } else if (tasksContainer.master && tasksContainer.master.tasks && Array.isArray(tasksContainer.master.tasks)) {
            // New tagged format (v0.17.0+) - Direct tag format { master: { tasks: [...] }, ... }
            isTaggedFormat = true;
            
            // Get current tag from state
            try {
                const statePath = path.join(this.taskmasterPath, 'state.json');
                if (fs.existsSync(statePath)) {
                    const stateData = JSON.parse(fs.readFileSync(statePath, 'utf8'));
                    currentTag = stateData.currentTag || 'master';
                }
            } catch (error) {
                log(`Could not read state.json, using 'master' tag: ${error}`);
            }
            
            // Extract tasks from current tag
            const tagData = tasksContainer[currentTag];
            if (tagData && tagData.tasks && Array.isArray(tagData.tasks)) {
                tasks = tagData.tasks;
            } else {
                // Fallback to master tag
                const masterData = tasksContainer.master;
                if (masterData && masterData.tasks && Array.isArray(masterData.tasks)) {
                    tasks = masterData.tasks;
                    currentTag = 'master';
                } else {
                    throw new Error(`No tasks found in tag '${currentTag}' or 'master' tag.`);
                }
            }
        } else if (tasksContainer.tags && typeof tasksContainer.tags === 'object') {
            // New tagged format (v0.17.0+) - Nested tag format { tags: { master: { tasks: [...] }, ... } }
            isTaggedFormat = true;
            
            // Get current tag from state
            try {
                const statePath = path.join(this.taskmasterPath, 'state.json');
                if (fs.existsSync(statePath)) {
                    const stateData = JSON.parse(fs.readFileSync(statePath, 'utf8'));
                    currentTag = stateData.currentTag || 'master';
                }
            } catch (error) {
                log(`Could not read state.json, using 'master' tag: ${error}`);
            }
            
            // Extract tasks from current tag
            const tagData = tasksContainer.tags[currentTag];
            if (tagData && tagData.tasks && Array.isArray(tagData.tasks)) {
                tasks = tagData.tasks;
            } else {
                // Fallback to master tag
                const masterData = tasksContainer.tags.master;
                if (masterData && masterData.tasks && Array.isArray(masterData.tasks)) {
                    tasks = masterData.tasks;
                    currentTag = 'master';
                } else {
                    throw new Error(`No tasks found in tag '${currentTag}' or 'master' tag.`);
                }
            }
        } else if (tasksContainer.tasks && Array.isArray(tasksContainer.tasks)) {
            // Legacy format
            tasks = tasksContainer.tasks;
        } else {
            throw new Error('Unknown tasks.json format');
        }
        
        return { tasks, isTaggedFormat, currentTag, originalContainer: tasksContainer };
    }

    /**
     * Helper method to write tasks back to the correct format
     */
    private writeTasksToContainer(
        tasks: any[], 
        isTaggedFormat: boolean, 
        currentTag: string, 
        originalContainer: any,
        filePath: string
    ): void {
        if (isTaggedFormat) {
            // Check if it's the direct tag format or nested tag format
            if (originalContainer.tags && typeof originalContainer.tags === 'object') {
                // Nested tag format { tags: { master: { tasks: [...] }, ... } }
                originalContainer.tags[currentTag].tasks = tasks;
            } else {
                // Direct tag format { master: { tasks: [...] }, ... }
                originalContainer[currentTag].tasks = tasks;
            }
        } else if (Array.isArray(originalContainer)) {
            // Direct array format - replace the entire array
            originalContainer.splice(0, originalContainer.length, ...tasks);
        } else {
            // Legacy format
            originalContainer.tasks = tasks;
        }
        
        fs.writeFileSync(filePath, JSON.stringify(originalContainer, null, 2), 'utf8');
    }

    async getTaskDetails(taskId: string, subtaskId?: string): Promise<Task | null> {
        try {
            log(`Getting task details for mainTaskId: ${taskId}, subtaskId: ${subtaskId || 'none'}`);
            const tasks = await this.getTasks();
            
            // If we have both mainTaskId and subtaskId, look for the specific subtask
            if (subtaskId) {
                log(`Looking for subtask ${subtaskId} within main task ${taskId}`);
                const mainTask = tasks.find(task => task.id.toString() === taskId.toString());
                if (mainTask && mainTask.subtasks) {
                    log(`Main task ${taskId} found with ${mainTask.subtasks.length} subtasks`);
                    
                    // Try multiple matching strategies for subtasks
                    let subtask: Task | undefined;
                    
                    // Strategy 1: Exact ID match
                    subtask = mainTask.subtasks.find(sub => sub.id.toString() === subtaskId.toString());
                    if (subtask) {
                        log(`Found subtask using exact ID match: ${subtaskId}`);
                        return subtask;
                    }
                    
                    // Strategy 2: Match using full dot notation (mainTaskId.subtaskId)
                    const fullSubtaskId = `${taskId}.${subtaskId}`;
                    subtask = mainTask.subtasks.find(sub => sub.id.toString() === fullSubtaskId);
                    if (subtask) {
                        log(`Found subtask using full dot notation: ${fullSubtaskId}`);
                        return subtask;
                    }
                    
                    // Strategy 3: For subtasks with dot notation IDs, match the suffix
                    subtask = mainTask.subtasks.find(sub => {
                        const subId = sub.id.toString();
                        if (subId.includes('.')) {
                            const suffix = subId.split('.').slice(1).join('.');
                            return suffix === subtaskId.toString();
                        }
                        return false;
                    });
                    if (subtask) {
                        log(`Found subtask using suffix match: ${subtask.id}`);
                        return subtask;
                    }
                    
                    log(`Subtask ${subtaskId} not found in main task ${taskId}. Available subtasks: ${mainTask.subtasks.map(s => s.id).join(', ')}`);
                } else if (!mainTask) {
                    log(`Main task ${taskId} not found`);
                } else {
                    log(`Main task ${taskId} has no subtasks`);
                }
                return null;
            }
            
            // If no subtaskId, look for the main task or handle dot notation
            if (taskId.includes('.')) {
                // Handle dot notation like "1.2" - split into mainTaskId and subtaskId
                const parts = taskId.split('.');
                const mainTaskId = parts[0] || '';
                const subtaskIdFromDot = parts.slice(1).join('.');
                
                log(`Dot notation detected: mainTaskId=${mainTaskId}, subtaskId=${subtaskIdFromDot}`);
                
                if (mainTaskId) {
                    const mainTask = tasks.find(task => task.id.toString() === mainTaskId.toString());
                    if (mainTask && mainTask.subtasks && subtaskIdFromDot) {
                        // For subtasks, we need to find by the full dotted ID or just the subtask part
                        const subtask = mainTask.subtasks.find(sub => 
                            sub.id.toString() === taskId.toString() || 
                            sub.id.toString() === subtaskIdFromDot.toString()
                        );
                        if (subtask) {
                            log(`Found subtask with dot notation: ${taskId}`);
                            return subtask;
                        }
                    }
                }
                log(`Task with dot notation ${taskId} not found`);
                return null;
            }
            
            // Look for main task with the given ID
            const mainTask = tasks.find(task => task.id.toString() === taskId.toString());
            if (mainTask) {
                log(`Found main task with ID: ${taskId}`);
                return mainTask;
            }
            
            // Legacy fallback: search all subtasks recursively (for backwards compatibility)
            const findSubtaskById = (searchTasks: Task[]): Task | undefined => {
                for (const task of searchTasks) {
                    if (task.subtasks && task.subtasks.length > 0) {
                        const foundInSubtasks = task.subtasks.find(subtask => 
                            subtask.id.toString() === taskId.toString()
                        );
                        if (foundInSubtasks) {
                            return foundInSubtasks;
                        }
                        // Recursively search deeper levels
                        const foundDeeper = findSubtaskById(task.subtasks);
                        if (foundDeeper) {
                            return foundDeeper;
                        }
                    }
                }
                return undefined;
            };

            const foundSubtask = findSubtaskById(tasks);
            
            if (foundSubtask) {
                log(`Found subtask with ID: ${taskId} (legacy search)`);
            } else {
                log(`Task with ID: ${taskId} not found.`);
            }
            return foundSubtask || null;

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log(`Error getting task details for ${taskId}: ${errorMessage}`);
            return null;
        }
    }

    async setTaskStatus(taskId: string, status: TaskStatus): Promise<void> {
        log(`Setting status for task ${taskId} to ${status}`);
        try {
            // Try MCP client first if available
            if (await this.isMCPServerAvailable()) {
                try {
                    const currentTag = this.tagManager.getCurrentTag();
                    log(`Using MCP client to set task status for tag: ${currentTag}`);
                    const mcpClient = await this.getMCPClient();
                    await mcpClient.setTaskStatus(taskId, status, currentTag);
                    return;
                } catch (error) {
                    log(`MCP setTaskStatus failed, falling back to file operations: ${error}`);
                }
            }

            // Fallback to file operations
            const tasksJsonPath = path.join(this.tasksPath, 'tasks.json');
            if (!fs.existsSync(tasksJsonPath)) {
                throw new Error('tasks.json not found');
            }

            const tasksData = fs.readFileSync(tasksJsonPath, 'utf8');
            const tasksContainer = JSON.parse(tasksData);
            const { tasks, isTaggedFormat, currentTag } = this.extractTasksFromContainer(tasksContainer);

            let taskUpdated = false;

            // First try to update main tasks (to prioritize main tasks over subtasks with same ID)
            for (const task of tasks) {
                if (task.id.toString() === taskId.toString()) {
                    task.status = this.denormalizeStatus(status) as any;
                    task.updated = new Date().toISOString();
                    taskUpdated = true;
                    break;
                }
            }

            // If main task not found, search subtasks recursively
            if (!taskUpdated) {
                const updateSubtaskRecursive = (items: Task[]) => {
                    for (const item of items) {
                        if (item.subtasks) {
                            for (const subtask of item.subtasks) {
                                if (subtask.id.toString() === taskId.toString()) {
                                    subtask.status = this.denormalizeStatus(status) as any;
                                    subtask.updated = new Date().toISOString();
                                    taskUpdated = true;
                                    return;
                                }
                            }
                            if (!taskUpdated) {
                                updateSubtaskRecursive(item.subtasks);
                                if (taskUpdated) {
                                    return;
                                }
                            }
                        }
                    }
                };
                
                updateSubtaskRecursive(tasks);
            }

            if (taskUpdated) {
                log(`Task ${taskId} found and status updated. Writing back to tasks.json.`);
                this.writeTasksToContainer(tasks, isTaggedFormat, currentTag, tasksContainer, tasksJsonPath);
            } else {
                log(`Task with ID ${taskId} not found for status update.`);
                throw new Error(`Task with ID ${taskId} not found.`);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log(`Error in setTaskStatus for ${taskId}: ${errorMessage}`);
            throw error;
        }
    }

    async updateTask(taskId: string, updates: Partial<Task>): Promise<void> {
        log(`Updating task ${taskId} with properties: ${Object.keys(updates).join(', ')}`);
        try {
            // Try MCP client first if available (if it supports generic task updates)
            if (await this.isMCPServerAvailable()) {
                try {
                    const currentTag = this.tagManager.getCurrentTag();
                    log(`Using MCP client to update task for tag: ${currentTag}`);
                    // const mcpClient = await this.getMCPClient();
                    
                    // For now, MCP client doesn't have a generic updateTask method
                    // Fall back to file operations
                    log(`MCP client doesn't support generic task updates, falling back to file operations`);
                } catch (error) {
                    log(`MCP updateTask failed, falling back to file operations: ${error}`);
                }
            }

            // File operations
            const tasksJsonPath = path.join(this.tasksPath, 'tasks.json');
            if (!fs.existsSync(tasksJsonPath)) {
                throw new Error('tasks.json not found');
            }

            const tasksData = fs.readFileSync(tasksJsonPath, 'utf8');
            const tasksContainer = JSON.parse(tasksData);
            const { tasks, isTaggedFormat, currentTag } = this.extractTasksFromContainer(tasksContainer);

            let taskUpdated = false;

            // Find and update the main task
            for (const task of tasks) {
                if (task.id.toString() === taskId.toString()) {
                    // Apply all updates to the task
                    Object.assign(task, updates);
                    // Always update the timestamp
                    task.updated = new Date().toISOString();
                    taskUpdated = true;
                    break;
                }
            }

            if (taskUpdated) {
                log(`Task ${taskId} found and updated. Writing back to tasks.json.`);
                this.writeTasksToContainer(tasks, isTaggedFormat, currentTag, tasksContainer, tasksJsonPath);
            } else {
                log(`Task with ID ${taskId} not found for update.`);
                throw new Error(`Task with ID ${taskId} not found.`);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log(`Error in updateTask for ${taskId}: ${errorMessage}`);
            throw error;
        }
    }

    /**
     * Set the status of a specific subtask within a parent task
     * This method ensures we update the correct subtask by requiring both parent and subtask IDs
     */
    async setSubtaskStatus(parentTaskId: string, subtaskId: string, status: TaskStatus): Promise<void> {
        log(`Setting status for subtask ${subtaskId} in parent task ${parentTaskId} to ${status}`);
        try {
            // Try MCP client first if available
            if (await this.isMCPServerAvailable()) {
                try {
                    const currentTag = this.tagManager.getCurrentTag();
                    log(`Using MCP client to set subtask status for tag: ${currentTag}`);
                    // For MCP, we can use the existing setTaskStatus method since MCP handles the context
                    const mcpClient = await this.getMCPClient();
                    await mcpClient.setTaskStatus(subtaskId, status, currentTag);
                    return;
                } catch (error) {
                    log(`MCP setSubtaskStatus failed, falling back to file operations: ${error}`);
                }
            }

            // Fallback to file operations
            const tasksJsonPath = path.join(this.tasksPath, 'tasks.json');
            if (!fs.existsSync(tasksJsonPath)) {
                throw new Error('tasks.json not found');
            }

            const tasksData = fs.readFileSync(tasksJsonPath, 'utf8');
            const tasksContainer = JSON.parse(tasksData);
            const { tasks, isTaggedFormat, currentTag } = this.extractTasksFromContainer(tasksContainer);

            // Find the parent task
            const parentTask = tasks.find(task => task.id.toString() === parentTaskId.toString());
            if (!parentTask) {
                throw new Error(`Parent task with ID ${parentTaskId} not found.`);
            }

            // Find the subtask within the parent
            if (!parentTask.subtasks) {
                throw new Error(`Parent task ${parentTaskId} has no subtasks.`);
            }

            const subtask = parentTask.subtasks.find((st: Task) => st.id.toString() === subtaskId.toString());
            if (!subtask) {
                throw new Error(`Subtask with ID ${subtaskId} not found in parent task ${parentTaskId}.`);
            }

            // Update the subtask status
            subtask.status = this.denormalizeStatus(status) as any;
            subtask.updated = new Date().toISOString();
            
            // Also update the parent task's updated timestamp
            parentTask.updated = new Date().toISOString();

            log(`Subtask ${subtaskId} in parent ${parentTaskId} found and status updated. Writing back to tasks.json.`);
            this.writeTasksToContainer(tasks, isTaggedFormat, currentTag, tasksContainer, tasksJsonPath);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log(`Error in setSubtaskStatus for subtask ${subtaskId} in parent ${parentTaskId}: ${errorMessage}`);
            throw error;
        }
    }

    async getNextTask(): Promise<Task | null> {
        try {
            const tasks = await this.getTasks();
            
            // Filter tasks that are not completed and have no pending dependencies
            const availableTasks = tasks.filter(task => {
                if (task.status === 'completed') {
                    return false;
                }
                
                // Check if all dependencies are completed
                if (task.dependencies && task.dependencies.length > 0) {
                    const dependencies = task.dependencies.map(depId => 
                        tasks.find(t => t.id.toString() === depId.toString())
                    );
                    
                    if (dependencies.some(dep => !dep || dep.status !== 'completed')) {
                        return false;
                    }
                }
                
                return true;
            });

            // Sort by priority and return the first one
            availableTasks.sort((a, b) => {
                const priorityOrder = { 'critical': 4, 'high': 3, 'medium': 2, 'low': 1 };
                const aPriority = priorityOrder[a.priority as keyof typeof priorityOrder] || 0;
                const bPriority = priorityOrder[b.priority as keyof typeof priorityOrder] || 0;
                return bPriority - aPriority;
            });

            return availableTasks[0] || null;
        } catch (error) {
            console.error('Error getting next task:', error);
            return null;
        }
    }

    async getTasksByStatus(status: Task['status']): Promise<Task[]> {
        try {
            const tasks = await this.getTasks();
            return tasks.filter(task => task.status === status);
        } catch (error) {
            console.error(`Error getting tasks by status ${status}:`, error);
            return [];
        }
    }

    async getTasksByPriority(priority: Task['priority']): Promise<Task[]> {
        try {
            const tasks = await this.getTasks();
            return tasks.filter(task => task.priority === priority);
        } catch (error) {
            console.error(`Error getting tasks by priority ${priority}:`, error);
            return [];
        }
    }

    async getTasksByCategory(category: string): Promise<Task[]> {
        try {
            const tasks = await this.getTasks();
            return tasks.filter(task => task.category === category);
        } catch (error) {
            console.error(`Error getting tasks by category ${category}:`, error);
            return [];
        }
    }

    async getTaskProgress(): Promise<{ 
        total: number; 
        completed: number; 
        inProgress: number; 
        todo: number; 
        blocked: number;
        mainTasks: {
            total: number;
            completed: number;
            inProgress: number;
            todo: number;
            blocked: number;
        };
        allItems: {
            total: number;
            completed: number;
            inProgress: number;
            todo: number;
            blocked: number;
        }
    }> {
        const tasks = await this.getTasks();
        
        // Count main tasks only
        let mainTotal = 0;
        let mainCompleted = 0;
        let mainInProgress = 0;
        let mainTodo = 0;
        let mainBlocked = 0;
        
        // Count all items (tasks + subtasks)
        let allTotal = 0;
        let allCompleted = 0;
        let allInProgress = 0;
        let allTodo = 0;
        let allBlocked = 0;

        const countMainTasks = (taskItems: Task[]) => {
            for (const task of taskItems) {
                mainTotal++;
                switch (this.normalizeStatus(task.status)) {
                    case 'completed':
                        mainCompleted++;
                        break;
                    case 'in-progress':
                        mainInProgress++;
                        break;
                    case 'todo':
                        mainTodo++;
                        break;
                    case 'blocked':
                        mainBlocked++;
                        break;
                }
            }
        };

        const countAllItems = (taskItems: Task[]) => {
            for (const task of taskItems) {
                allTotal++;
                switch (this.normalizeStatus(task.status)) {
                    case 'completed':
                        allCompleted++;
                        break;
                    case 'in-progress':
                        allInProgress++;
                        break;
                    case 'todo':
                        allTodo++;
                        break;
                    case 'blocked':
                        allBlocked++;
                        break;
                }
                if (task.subtasks) {
                    countAllItems(task.subtasks);
                }
            }
        };

        countMainTasks(tasks);
        countAllItems(tasks);
        
        log(`Calculated progress - Main Tasks: Total=${mainTotal}, Completed=${mainCompleted}, InProgress=${mainInProgress}, Todo=${mainTodo}, Blocked=${mainBlocked}`);
        log(`Calculated progress - All Items: Total=${allTotal}, Completed=${allCompleted}, InProgress=${allInProgress}, Todo=${allTodo}, Blocked=${allBlocked}`);

        // Return both old format (for backward compatibility) and new detailed format
        return { 
            // Legacy format (all items) for backward compatibility
            total: allTotal, 
            completed: allCompleted, 
            inProgress: allInProgress, 
            todo: allTodo, 
            blocked: allBlocked,
            // New detailed format
            mainTasks: {
                total: mainTotal,
                completed: mainCompleted,
                inProgress: mainInProgress,
                todo: mainTodo,
                blocked: mainBlocked
            },
            allItems: {
                total: allTotal,
                completed: allCompleted,
                inProgress: allInProgress,
                todo: allTodo,
                blocked: allBlocked
            }
        };
    }

    getTaskmasterPath(): string {
        return this.taskmasterPath;
    }

    hasTaskmaster(): boolean {
        return fs.existsSync(this.taskmasterPath);
    }

    async getPRDPath(): Promise<string | null> {
        try {
            const scriptsPath = path.join(this.taskmasterPath, '..', 'scripts');
            if (fs.existsSync(scriptsPath)) {
                const files = fs.readdirSync(scriptsPath);
                const prdFile = files.find(file => file.toLowerCase().startsWith('prd.'));
                if (prdFile) {
                    const prdPath = path.join(scriptsPath, prdFile);
                    log(`Found PRD file at: ${prdPath}`);
                return prdPath;
            }
        }
            log('PRD file not found.');
            return null;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log(`Error finding PRD path: ${errorMessage}`);
        return null;
        }
    }

    async getConfig(): Promise<any> {
        try {
            if (fs.existsSync(this.configPath)) {
                log(`Reading config from: ${this.configPath}`);
                const configData = fs.readFileSync(this.configPath, 'utf8');
                return JSON.parse(configData);
            }
            log('Config file not found.');
            return null;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log(`Error reading config: ${errorMessage}`);
            return null;
        }
    }

    // Subtask Operations
    
    /**
     * Get subtasks for a parent task
     * @param parentTaskId The ID of the parent task
     * @returns Array of subtasks or empty array if none found
     */
    async getSubtasks(parentTaskId: string): Promise<Task[]> {
        log(`Getting subtasks for parent ${parentTaskId}`);
        try {
            const tasks = await this.getTasks();
            const parentTask = tasks.find(task => task.id.toString() === parentTaskId.toString());
            
            if (!parentTask) {
                throw new Error(`Parent task ${parentTaskId} not found`);
            }
            
            if (parentTask && parentTask.subtasks) {
                log(`Found ${parentTask.subtasks.length} subtasks for parent ${parentTaskId}.`);
                return parentTask.subtasks;
            }
            log(`No subtasks found for parent ${parentTaskId}.`);
            return [];
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log(`Error getting subtasks for ${parentTaskId}: ${errorMessage}`);
            return [];
        }
    }
    
    /**
     * Add a new subtask to a parent task
     * @param parentTaskId The ID of the parent task
     * @param subtask The subtask object to add
     */
    async addSubtask(parentTaskId: string, subtask: Omit<Task, 'id'> & { id?: string }): Promise<void> {
        log(`Adding subtask to parent ${parentTaskId}`);
        try {
            const tasksJsonPath = path.join(this.tasksPath, 'tasks.json');
            if (!fs.existsSync(tasksJsonPath)) {
                throw new Error('tasks.json not found');
            }

                const tasksData = fs.readFileSync(tasksJsonPath, 'utf8');
            const tasksContainer = JSON.parse(tasksData);
            const { tasks, isTaggedFormat, currentTag } = this.extractTasksFromContainer(tasksContainer);

            // Find parent task recursively
            const findParent = (items: Task[]): Task | undefined => {
                for (const item of items) {
                    if (item.id.toString() === parentTaskId.toString()) {
                        return item;
                    }
                    if (item.subtasks) {
                        const found = findParent(item.subtasks);
                        if (found) {
                            return found;
                        }
                    }
                }
                return undefined;
            };

            const parentTask = findParent(tasks);

            if (parentTask) {
                if (!parentTask.subtasks) {
                    parentTask.subtasks = [];
                }
                
                // Generate new subtask ID (simple integer, not dotted notation)
                const newSubtaskId = (parentTask.subtasks.length + 1).toString();
                const newSubtask: Task = {
                    id: newSubtaskId,
                    ...subtask,
                    status: this.normalizeStatus(subtask.status || 'pending'),
                    created: new Date().toISOString(),
                    updated: new Date().toISOString()
                };

                parentTask.subtasks.push(newSubtask);
                log(`Added subtask ${newSubtaskId} to parent ${parentTaskId}.`);

                this.writeTasksToContainer(tasks, isTaggedFormat, currentTag, tasksContainer, tasksJsonPath);
            } else {
                throw new Error(`Parent task with ID ${parentTaskId} not found.`);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log(`Error in addSubtask: ${errorMessage}`);
            throw error;
        }
    }
    
    /**
     * Update a specific subtask
     * @param parentTaskId The ID of the parent task
     * @param subtaskId The ID of the subtask to update (can be full ID like "1.2" or just the suffix like "2")
     * @param updates Partial task object with properties to update
     */
    async updateSubtask(parentTaskId: string, subtaskId: string, updates: Partial<Task>): Promise<void> {
        log(`Updating subtask ${subtaskId} in parent ${parentTaskId}`);
        try {
            // Handle both full subtask ID ("1.2") and suffix ("2") formats
            const fullSubtaskId = subtaskId.includes('.') ? subtaskId : `${parentTaskId}.${subtaskId}`;
            
            // Try to update tasks.json first
            const tasksJsonPath = path.join(this.tasksPath, 'tasks.json');
            if (fs.existsSync(tasksJsonPath)) {
                const tasksData = fs.readFileSync(tasksJsonPath, 'utf8');
                const parsed = JSON.parse(tasksData);
                const { tasks, isTaggedFormat, currentTag } = this.extractTasksFromContainer(parsed);
                
                const parentIndex = tasks.findIndex((task: any) => 
                    task.id.toString() === parentTaskId.toString()
                );
                
                if (parentIndex !== -1) {
                    const parent = tasks[parentIndex];
                    if (parent.subtasks) {
                        const subtaskIndex = parent.subtasks.findIndex((st: any) => 
                            st.id.toString() === fullSubtaskId.toString() || st.id.toString() === subtaskId.toString()
                        );
                        
                        if (subtaskIndex !== -1) {
                            const updatedSubtask = {
                                ...parent.subtasks[subtaskIndex],
                                ...updates,
                                updated: new Date().toISOString()
                            };
                            
                            // Convert status if provided
                            if (updates.status) {
                                updatedSubtask.status = this.denormalizeStatus(updates.status as any);
                            }
                            
                            parent.subtasks[subtaskIndex] = updatedSubtask;
                            parent.updated = new Date().toISOString();
                            
                            this.writeTasksToContainer(tasks, isTaggedFormat, currentTag, parsed, tasksJsonPath);
                            return;
                        }
                    }
                }
                
                throw new Error(`Subtask ${fullSubtaskId} not found in parent ${parentTaskId}`);
            }
            
            // Fall back to individual task file
            const taskFilePath = path.join(this.tasksPath, `${parentTaskId}.json`);
            if (fs.existsSync(taskFilePath)) {
                const taskData = JSON.parse(fs.readFileSync(taskFilePath, 'utf8'));
                
                if (taskData.subtasks) {
                    const subtaskIndex = taskData.subtasks.findIndex((st: any) => 
                        st.id.toString() === fullSubtaskId.toString() || st.id.toString() === subtaskId.toString()
                    );
                    
                    if (subtaskIndex !== -1) {
                        const updatedSubtask = {
                            ...taskData.subtasks[subtaskIndex],
                            ...updates,
                            updated: new Date().toISOString()
                        };
                        
                        // Convert status if provided
                        if (updates.status) {
                            updatedSubtask.status = this.denormalizeStatus(updates.status as any);
                        }
                        
                        taskData.subtasks[subtaskIndex] = updatedSubtask;
                        taskData.updated = new Date().toISOString();
                        
                        fs.writeFileSync(taskFilePath, JSON.stringify(taskData, null, 2));
                        return;
                    }
                }
                
                throw new Error(`Subtask ${fullSubtaskId} not found in parent ${parentTaskId}`);
            } else {
                throw new Error(`Parent task ${parentTaskId} not found`);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log(`Error updating subtask ${subtaskId} in ${parentTaskId}: ${errorMessage}`);
            throw error;
        }
    }
    
    /**
     * Remove a subtask from a parent task
     * @param parentTaskId The ID of the parent task
     * @param subtaskId The ID of the subtask to remove (can be full ID like "1.2" or just the suffix like "2")
     */
    async removeSubtask(parentTaskId: string, subtaskId: string): Promise<void> {
        log(`Removing subtask ${subtaskId} from parent ${parentTaskId}.`);
        try {
            const tasksJsonPath = path.join(this.tasksPath, 'tasks.json');
            if (!fs.existsSync(tasksJsonPath)) {
                throw new Error('tasks.json not found');
            }

            const tasksData = fs.readFileSync(tasksJsonPath, 'utf8');
            const tasksContainer = JSON.parse(tasksData);
            const { tasks, isTaggedFormat, currentTag } = this.extractTasksFromContainer(tasksContainer);

            // Find parent task recursively
            const findParent = (items: Task[]): Task | undefined => {
                for (const item of items) {
                    if (item.id.toString() === parentTaskId.toString()) {
                        return item;
                    }
                    if (item.subtasks) {
                        const found = findParent(item.subtasks);
                        if (found) {
                            return found;
                        }
                    }
                }
                return undefined;
            };

            const parentTask = findParent(tasks);
                
            if (parentTask && parentTask.subtasks) {
                const initialLength = parentTask.subtasks.length;
                parentTask.subtasks = parentTask.subtasks.filter(st => 
                    st.id.toString() !== subtaskId.toString() && 
                    st.id.toString() !== `${parentTaskId}.${subtaskId}`
                );
                        
                if (parentTask.subtasks.length < initialLength) {
                    log(`Subtask ${subtaskId} removed. Writing updates.`);
                    parentTask.updated = new Date().toISOString();
                    this.writeTasksToContainer(tasks, isTaggedFormat, currentTag, tasksContainer, tasksJsonPath);
                } else {
                    log(`Subtask ${subtaskId} not found under parent ${parentTaskId}.`);
                    throw new Error(`Subtask ${subtaskId} not found under parent ${parentTaskId}.`);
                }
            } else {
                throw new Error(`Parent task ${parentTaskId} not found or has no subtasks.`);
            }

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log(`Error removing subtask: ${errorMessage}`);
            throw error;
        }
    }

    /**
     * Delete a main task
     * @param taskId The ID of the main task to delete
     */
    async deleteTask(taskId: string): Promise<void> {
        log(`Deleting main task ${taskId}.`);
        try {
            const tasksJsonPath = path.join(this.tasksPath, 'tasks.json');
            if (!fs.existsSync(tasksJsonPath)) {
                throw new Error('tasks.json not found');
            }

            const tasksData = fs.readFileSync(tasksJsonPath, 'utf8');
            const tasksContainer = JSON.parse(tasksData);
            const { tasks, isTaggedFormat, currentTag } = this.extractTasksFromContainer(tasksContainer);

            const initialLength = tasks.length;
            const filteredTasks = tasks.filter(task => task.id.toString() !== taskId.toString());
                
            if (filteredTasks.length < initialLength) {
                log(`Main task ${taskId} deleted. Writing updates.`);
                this.writeTasksToContainer(filteredTasks, isTaggedFormat, currentTag, tasksContainer, tasksJsonPath);
            } else {
                log(`Main task ${taskId} not found.`);
                throw new Error(`Main task ${taskId} not found.`);
            }

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log(`Error deleting main task: ${errorMessage}`);
            throw error;
        }
    }

    /**
     * Check if MCP server is available by attempting to call a simple MCP function
     */
    async isMCPServerAvailable(): Promise<boolean> {
        try {
            // First check if we can even load MCP
            if (!(await this.isMCPAvailable())) {
                return false;
            }
            
            // Then check if server is available
            const mcpClient = await this.getMCPClient();
            return await mcpClient.isAvailable();
        } catch (error) {
            log(`MCP server check failed: ${error}`);
            return false;
        }
    }

    /**
     * Get version check interval from configuration
     */
    private getVersionCheckInterval(): number {
        try {
            const vscode = require('vscode');
            const config = vscode.workspace.getConfiguration('claudeTaskMaster');
            return config.get('versionCheckInterval', 300000); // Default 5 minutes
        } catch (error) {
            return 300000; // Default 5 minutes if VS Code API not available
        }
    }

    /**
     * Check if CLI should be preferred over MCP on version mismatch
     */
    private shouldPreferCLIOnVersionMismatch(): boolean {
        try {
            const vscode = require('vscode');
            const config = vscode.workspace.getConfiguration('claudeTaskMaster');
            return config.get('preferCLIOnVersionMismatch', true);
        } catch (error) {
            return true; // Default to preferring CLI if VS Code API not available
        }
    }

    /**
     * Check if task-master command is available and get version (with caching)
     */
    private async isTaskMasterInstalled(): Promise<boolean> {
        // Return cached result if available and recent (cache based on config)
        const now = Date.now();
        const cacheInterval = this.getVersionCheckInterval();
        if (this.taskMasterInstalled !== null && (now - this.versionCheckTimestamp) < cacheInterval) {
            return this.taskMasterInstalled;
        }

        try {
            // Try to run task-master --version to check if it's installed
            const { stdout } = await execAsync('task-master --version', {
                cwd: this.taskmasterPath,
                timeout: 5000 // 5 second timeout for version check
            });
            
            this.cliVersion = stdout.trim();
            this.taskMasterInstalled = true;
            this.versionCheckTimestamp = now;
            log(`task-master command is available, version: ${this.cliVersion}`);
            return true;
        } catch (error) {
            this.taskMasterInstalled = false;
            this.cliVersion = null;
            this.versionCheckTimestamp = now;
            log(`task-master command not available: ${error}`);
            return false;
        }
    }

    /**
     * Get CLI version if available
     */
    async getCLIVersion(): Promise<string | null> {
        await this.isTaskMasterInstalled();
        return this.cliVersion;
    }

    /**
     * Get MCP server version if available
     */
    async getMCPVersion(): Promise<string | null> {
        try {
            if (await this.isMCPServerAvailable()) {
                const mcpClient = await this.getMCPClient();
                // Try to get version from MCP server
                // This would depend on the MCP server implementing a version endpoint
                const result = await mcpClient.getVersion?.();
                this.mcpVersion = result || 'unknown';
                return this.mcpVersion;
            }
        } catch (error) {
            log(`Could not get MCP version: ${error}`);
        }
        return null;
    }

    /**
     * Validate and sanitize tasks response from any source (MCP/CLI/file)
     */
    private validateTasksResponse(tasks: any, source: string): Task[] | null {
        try {
            if (!tasks) {
                log(`${source} returned null/undefined tasks`);
                return null;
            }

            if (!Array.isArray(tasks)) {
                log(`${source} returned non-array tasks: ${typeof tasks}`);
                return null;
            }

            // Validate each task has required fields
            const validTasks: Task[] = [];
            for (let i = 0; i < tasks.length; i++) {
                const task = tasks[i];
                
                if (!task) {
                    log(`${source} task ${i} is null/undefined, skipping`);
                    continue;
                }

                if (!task.id) {
                    log(`${source} task ${i} missing ID, skipping`);
                    continue;
                }

                if (!task.title) {
                    log(`${source} task ${i} (${task.id}) missing title, skipping`);
                    continue;
                }

                // Sanitize and normalize the task
                const sanitizedTask: Task = {
                    id: String(task.id), // Ensure ID is string
                    title: String(task.title),
                    description: task.description ? String(task.description) : '',
                    details: task.details ? String(task.details) : '',
                    status: this.normalizeStatus(task.status || 'pending'),
                    priority: task.priority || 'medium',
                    category: task.category || '',
                    created: task.created || new Date().toISOString(),
                    updated: task.updated || new Date().toISOString(),
                    dependencies: Array.isArray(task.dependencies) 
                        ? task.dependencies.map((dep: any) => String(dep))
                        : [],
                    subtasks: []
                };

                // Recursively validate and sanitize subtasks
                if (task.subtasks && Array.isArray(task.subtasks)) {
                    const validatedSubtasks = this.validateTasksResponse(task.subtasks, `${source} subtasks`);
                    if (validatedSubtasks) {
                        sanitizedTask.subtasks = validatedSubtasks;
                    }
                }

                validTasks.push(sanitizedTask);
            }

            log(`${source} validation: ${validTasks.length}/${tasks.length} tasks passed validation`);
            return validTasks;
        } catch (error) {
            log(`Error validating ${source} tasks response: ${error}`);
            return null;
        }
    }


    /**
     * Log detailed version information for debugging
     */
    private logVersionDetails(versionCheck: { 
        compatible: boolean; 
        cliVersion: string | null; 
        mcpVersion: string | null; 
        warning?: string 
    }): void {
        log(`📊 VERSION INFO:`);
        log(`   - CLI Version: ${versionCheck.cliVersion || 'Not available'}`);
        log(`   - MCP Version: ${versionCheck.mcpVersion || 'Not available'}`);
        log(`   - Compatible: ${versionCheck.compatible ? '✅' : '❌'}`);
        log(`   - Prefer CLI on mismatch: ${this.shouldPreferCLIOnVersionMismatch() ? '✅' : '❌'}`);
        
        if (versionCheck.warning) {
            log(`   - Warning: ${versionCheck.warning}`);
        }
    }

    /**
     * Show version warning to user via VS Code notification
     */
    private showVersionWarningToUser(versionCheck: { 
        compatible: boolean; 
        cliVersion: string | null; 
        mcpVersion: string | null; 
        warning?: string 
    }): void {
        try {
            const vscode = require('vscode');
            
            if (!versionCheck.compatible && versionCheck.warning) {
                const message = `Task Master Version Mismatch: ${versionCheck.warning}`;
                const actions = ['Update CLI', 'Use CLI Only', 'Ignore'];
                
                vscode.window.showWarningMessage(message, ...actions).then((selection: string) => {
                    switch (selection) {
                        case 'Update CLI':
                            vscode.env.openExternal(vscode.Uri.parse('https://www.npmjs.com/package/task-master-ai'));
                            break;
                        case 'Use CLI Only':
                            const config = vscode.workspace.getConfiguration('claudeTaskMaster');
                            config.update('disableMCP', true, vscode.ConfigurationTarget.Workspace);
                            vscode.window.showInformationMessage('MCP disabled for this workspace. Restart VS Code to apply changes.');
                            break;
                        case 'Ignore':
                            // User chose to ignore
                            break;
                    }
                });
                
                log(`🔔 Showed version warning notification to user: ${message}`);
            }
        } catch (error) {
            log(`Could not show version warning to user: ${error}`);
        }
    }

    /**
     * Log operation results with version context
     */
    private logOperationResult(operation: string, source: 'MCP' | 'CLI' | 'File', success: boolean, details?: string): void {
        const emoji = success ? '✅' : '❌';
        const versionInfo = source === 'MCP' ? this.mcpVersion : 
                           source === 'CLI' ? this.cliVersion : 'N/A';
        
        log(`${emoji} ${operation.toUpperCase()} via ${source} (v${versionInfo || 'unknown'}): ${success ? 'SUCCESS' : 'FAILED'}`);
        
        if (details) {
            log(`   Details: ${details}`);
        }
        
        if (!success && source === 'MCP') {
            log(`   💡 Consider using CLI fallback or updating versions to match`);
        }
    }

    /**
     * Check if there's a version mismatch between CLI and MCP that could cause issues
     */
    async checkVersionCompatibility(): Promise<{ 
        compatible: boolean; 
        cliVersion: string | null; 
        mcpVersion: string | null; 
        warning?: string 
    }> {
        const cliVersion = await this.getCLIVersion();
        const mcpVersion = await this.getMCPVersion();
        
        // If we can't get versions, assume compatible but warn
        if (!cliVersion && !mcpVersion) {
            return {
                compatible: true,
                cliVersion: null,
                mcpVersion: null,
                warning: 'Unable to determine version compatibility - both CLI and MCP unavailable'
            };
        }

        if (!cliVersion) {
            return {
                compatible: true,
                cliVersion: null,
                mcpVersion,
                warning: 'CLI not available, using MCP only'
            };
        }

        if (!mcpVersion) {
            return {
                compatible: true,
                cliVersion,
                mcpVersion: null,
                warning: 'MCP not available, using CLI only'
            };
        }

        // Simple version comparison (assumes semver format)
        const parseCLIVersion = (v: string) => {
            const match = v.match(/(\d+)\.(\d+)\.(\d+)/);
            return match ? [parseInt(match[1]!), parseInt(match[2]!), parseInt(match[3]!)] : [0, 0, 0];
        };

        const cliVersionParts = parseCLIVersion(cliVersion);
        const mcpVersionParts = parseCLIVersion(mcpVersion);

        // Check for major version differences
        if (cliVersionParts[0] !== mcpVersionParts[0]) {
            return {
                compatible: false,
                cliVersion,
                mcpVersion,
                warning: `Major version mismatch: CLI v${cliVersion} vs MCP v${mcpVersion}. This may cause data inconsistencies.`
            };
        }

        // Check for minor version differences
        if (Math.abs(cliVersionParts[1]! - mcpVersionParts[1]!) > 1) {
            return {
                compatible: false,
                cliVersion,
                mcpVersion,
                warning: `Significant version difference: CLI v${cliVersion} vs MCP v${mcpVersion}. Consider updating both to the same version.`
            };
        }

        return {
            compatible: true,
            cliVersion,
            mcpVersion
        };
    }

    /**
     * Execute a task-master CLI command as fallback when MCP is not available
     */
    private async executeTaskMasterCLI(command: string, args: string[] = []): Promise<string> {
        try {
            // Check if task-master is installed first
            const isInstalled = await this.isTaskMasterInstalled();
            
            if (isInstalled) {
                // Use direct task-master command
                const fullCommand = `task-master ${command} ${args.join(' ')}`;
                log(`Executing CLI with direct command: ${fullCommand}`);
                
                const { stdout, stderr } = await execAsync(fullCommand, {
                    cwd: this.taskmasterPath,
                    timeout: 30000 // 30 second timeout
                });
                
                if (stderr && !stderr.includes('npm WARN')) {
                    log(`CLI command stderr: ${stderr}`);
                }
                
                return stdout;
            } else {
                // Fall back to npx
                const fullCommand = `npx task-master-ai ${command} ${args.join(' ')}`;
                log(`task-master not installed, using npx fallback: ${fullCommand}`);
                
                const { stdout, stderr } = await execAsync(fullCommand, {
                    cwd: this.taskmasterPath,
                    timeout: 30000 // 30 second timeout
                });
                
                if (stderr && !stderr.includes('npm WARN')) {
                    log(`CLI command stderr: ${stderr}`);
                }
                
                return stdout;
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log(`CLI command failed: ${errorMessage}`);
            throw new Error(`Task Master CLI command failed: ${errorMessage}`);
        }
    }

    /**
     * Add a new task with CLI fallback
     */
    async addTask(task: Omit<Task, 'id'>, useCLI: boolean = false, tagContext?: string): Promise<void> {
        // Use provided tag context or fall back to current tag
        const targetTag = tagContext || this.tagManager.getCurrentTag();
        
        if (!useCLI && await this.isMCPServerAvailable()) {
            // Try MCP first
            try {
                const mcpClient = await this.getMCPClient();
                await mcpClient.addTask(task, targetTag);
                log(`Task added via MCP: ${task.title} (tag: ${targetTag})`);
                return;
            } catch (error) {
                log(`MCP addTask failed, falling back to CLI: ${error}`);
                useCLI = true;
            }
        }

        if (useCLI) {
            const args = [
                '--prompt', `"${task.title}: ${task.description || ''}"`,
                '--priority', task.priority || 'medium'
            ];
            
            if (task.dependencies && task.dependencies.length > 0) {
                args.push('--dependencies', task.dependencies.join(','));
            }
            
            // Add tag parameter if not master tag
            if (targetTag !== 'master') {
                args.push('--tag', targetTag);
            }

            await this.executeTaskMasterCLI('add-task', args);
            log(`Task added via CLI: ${task.title} (tag: ${targetTag})`);
        }
    }

    /**
     * Add a subtask with CLI fallback
     */
    async addSubtaskWithCLI(parentTaskId: string, subtask: Omit<Task, 'id'> & { id?: string }): Promise<void> {
        const useCLI = !(await this.isMCPServerAvailable());
        
        if (useCLI) {
            const currentTag = this.tagManager.getCurrentTag();
            const args = [
                '--parent', parentTaskId.toString(),
                '--title', `"${subtask.title}"`,
                '--status', this.denormalizeStatus(subtask.status || 'todo')
            ];
            
            if (subtask.description) {
                args.push('--description', `"${subtask.description}"`);
            }
            
            if (subtask.priority) {
                args.push('--priority', subtask.priority);
            }
            
            // Add tag parameter if not master tag
            if (currentTag !== 'master') {
                args.push('--tag', currentTag);
            }

            await this.executeTaskMasterCLI('add-subtask', args);
            log(`Subtask added via CLI: ${subtask.title} to parent ${parentTaskId} (tag: ${currentTag})`);
        } else {
            // Fall back to existing method if MCP is available
            await this.addSubtask(parentTaskId, subtask);
        }
    }

    /**
     * Set task status with CLI fallback
     */
    async setTaskStatusWithCLI(taskId: string, status: TaskStatus, tagContext?: string): Promise<void> {
        // Use provided tag context or fall back to current tag
        const targetTag = tagContext || this.tagManager.getCurrentTag();
        const useCLI = !(await this.isMCPServerAvailable());
        
        if (useCLI) {
            const args = [
                '--id', taskId.toString(),
                '--status', this.denormalizeStatus(status)
            ];
            
            // Add tag parameter if not master tag
            if (targetTag !== 'master') {
                args.push('--tag', targetTag);
            }

            await this.executeTaskMasterCLI('set-status', args);
            log(`Task status updated via CLI: ${taskId} -> ${status} (tag: ${targetTag})`);
        } else {
            // Fall back to existing method if MCP is available
            await this.setTaskStatus(taskId, status);
        }
    }

    /**
     * Expand task with CLI fallback
     */
    async expandTaskWithCLI(taskId: string, force: boolean = false, tagContext?: string): Promise<void> {
        // Use provided tag context or fall back to current tag
        const targetTag = tagContext || this.tagManager.getCurrentTag();
        const useCLI = !(await this.isMCPServerAvailable());
        
        if (useCLI) {
            const args = [
                '--id', taskId.toString()
            ];
            
            if (force) {
                args.push('--force');
            }
            
            // Add tag parameter if not master tag
            if (targetTag !== 'master') {
                args.push('--tag', targetTag);
            }

            await this.executeTaskMasterCLI('expand', args);
            log(`Task expanded via CLI: ${taskId} (tag: ${targetTag})`);
        } else {
            // Try MCP expand functionality
            try {
                const mcpClient = await this.getMCPClient();
                await mcpClient.expandTask(taskId, force, targetTag);
                log(`Task expanded via MCP: ${taskId} (tag: ${targetTag})`);
            } catch (error) {
                throw new Error(`MCP server expand functionality failed: ${error}`);
            }
        }
    }

    /**
     * Update task with CLI fallback
     */
    async updateTaskWithCLI(taskId: string, prompt: string): Promise<void> {
        const useCLI = !(await this.isMCPServerAvailable());
        
        if (useCLI) {
            const args = [
                '--id', taskId.toString(),
                '--prompt', `"${prompt}"`
            ];

            await this.executeTaskMasterCLI('update-task', args);
            log(`Task updated via CLI: ${taskId}`);
        } else {
            throw new Error('MCP server update functionality not implemented yet');
        }
    }

    /**
     * Get next task with CLI fallback
     */
    async getNextTaskWithCLI(): Promise<Task | null> {
        const useCLI = !(await this.isMCPServerAvailable());
        
        if (useCLI) {
            try {
                const output = await this.executeTaskMasterCLI('next');
                // Parse the CLI output to extract task information
                // This would need to be adapted based on the actual CLI output format
                const lines = output.split('\n').filter(line => line.trim());
                
                // Look for task ID pattern in the output
                for (const line of lines) {
                    const match = line.match(/Task (\d+(?:\.\d+)*):(.+)/);
                    if (match) {
                        const [, id] = match;
                        // Get full task details
                        const allTasks = await this.getTasks();
                        return allTasks.find(t => t.id === id) || null;
                    }
                }
                
                return null;
            } catch (error) {
                log(`CLI next task failed: ${error}`);
                return null;
            }
        } else {
            // Fall back to existing method if MCP is available
            return await this.getNextTask();
        }
    }

    /**
     * Initialize project with CLI fallback
     */
    async initializeProjectWithCLI(): Promise<void> {
        try {
            await this.executeTaskMasterCLI('init', ['--yes']);
            log('Project initialized via CLI');
        } catch (error) {
            throw new Error(`Failed to initialize project: ${error}`);
        }
    }

    /**
     * Show helpful message about CLI fallback being used
     */
    showCLIFallbackMessage(action: string): void {
        vscode.window.showInformationMessage(
            `${action} - Using Task Master CLI (MCP server not available)`,
            'Learn More'
        ).then(selection => {
            if (selection === 'Learn More') {
                vscode.env.openExternal(vscode.Uri.parse('https://github.com/task-master-ai/task-master-ai#mcp-setup'));
            }
        });
    }

    /**
     * Get tag manager instance
     */
    getTagManager(): TagManager {
        return this.tagManager;
    }

    /**
     * Get current tag information
     */
    getCurrentTag(): string {
        return this.tagManager.getCurrentTag();
    }

    /**
     * Get available tags
     */
    getAvailableTags(): string[] {
        return this.tagManager.getAvailableTags();
    }

    /**
     * Get tag context information
     */
    getTagContext(): { currentTag: string; availableTags: string[]; isTaggedFormat: boolean } {
        return this.tagManager.getTagContext();
    }

    /**
     * Switch to a different tag
     */
    async switchTag(tagName: string): Promise<void> {
        try {
            // Try MCP client first if available
            if (await this.isMCPServerAvailable()) {
                const mcpClient = await this.getMCPClient();
                await mcpClient.switchTag(tagName);
            }
            
            // Update local tag manager
            this.tagManager.setCurrentTag(tagName);
            log(`Switched to tag: ${tagName}`);
        } catch (error) {
            log(`Error switching to tag ${tagName}: ${error}`);
            throw error;
        }
    }

    /**
     * Create a new tag
     */
    async createTag(tagName: string): Promise<void> {
        try {
            // Use CLI approach for tag creation with proper command
            await this.executeTaskMasterCLI('add-tag', [tagName]);
            
            log(`Created tag: ${tagName}`);
        } catch (error) {
            log(`Error creating tag ${tagName}: ${error}`);
            throw error;
        }
    }

    /**
     * Delete a tag
     */
    async deleteTag(tagName: string): Promise<void> {
        try {
            if (tagName === 'master') {
                throw new Error('Cannot delete the master tag');
            }
            
            // Use CLI approach for tag deletion with proper command
            await this.executeTaskMasterCLI('delete-tag', [tagName, '--yes']);
            
            // If we deleted the current tag, switch to master
            if (this.tagManager.getCurrentTag() === tagName) {
                this.tagManager.setCurrentTag('master');
            }
            
            log(`Deleted tag: ${tagName}`);
        } catch (error) {
            log(`Error deleting tag ${tagName}: ${error}`);
            throw error;
        }
    }

    /**
     * Check if the current format is tagged
     */
    isTaggedFormat(): boolean {
        return this.tagManager.isTaggedFormat();
    }
} 