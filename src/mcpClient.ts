import { log } from './logger';
import { Task, TaskStatus } from './types';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

// Dynamic imports for MCP SDK to prevent blocking extension load
let MCPClientClass: any = null;
let MCPStdioClientTransportClass: any = null;
let mcpImportError: string | null = null;

// Lazy load MCP SDK with error handling
async function loadMCPSDK() {
    if (MCPClientClass && MCPStdioClientTransportClass) {
        return { Client: MCPClientClass, StdioClientTransport: MCPStdioClientTransportClass };
    }
    
    if (mcpImportError) {
        throw new Error(`MCP SDK previously failed to load: ${mcpImportError}`);
    }
    
    try {
        // Use absolute path resolution to avoid export map issues
        const path = require('path');
        const clientPath = path.resolve(__dirname, '../node_modules/@modelcontextprotocol/sdk/dist/cjs/client/index.js');
        const stdioPath = path.resolve(__dirname, '../node_modules/@modelcontextprotocol/sdk/dist/cjs/client/stdio.js');
        
        const clientModule = require(clientPath);
        const stdioModule = require(stdioPath);
        
        MCPClientClass = clientModule.Client;
        MCPStdioClientTransportClass = stdioModule.StdioClientTransport;
        
        log('MCP SDK loaded successfully');
        return { Client: MCPClientClass, StdioClientTransport: MCPStdioClientTransportClass };
    } catch (error) {
        mcpImportError = error instanceof Error ? error.message : String(error);
        log(`Failed to load MCP SDK: ${mcpImportError}`);
        throw new Error(`MCP SDK not available: ${mcpImportError}`);
    }
}

/**
 * MCP Client for integrating with task-master-ai MCP tools
 * Supports the new tagged format introduced in v0.17.0
 */
export class MCPClient {
    private projectRoot: string;
    private currentTag: string = 'master';
    private client: any | null = null;
    private transport: any | null = null;
    private isConnected: boolean = false;

    constructor(projectRoot: string) {
        this.projectRoot = projectRoot;
        log(`MCPClient initialized for project: ${projectRoot}`);
    }

    /**
     * Find the best available task-master-ai command
     */
    private async findTaskMasterCommand(): Promise<{ command: string; args: string[] }> {
        // First try globally installed task-master-ai
        try {
            execSync('task-master-ai --version', { stdio: 'pipe' });
            log('Using globally installed task-master-ai');
            return { command: 'task-master-ai', args: [] };
        } catch (error) {
            log('Global task-master-ai not found, falling back to npx');
        }

        // Fallback to npx (but warn about potential issues)
        log('Warning: Using npx task-master-ai may cause MCP connection issues. Consider installing globally: npm install -g task-master-ai');
        return { command: 'npx', args: ['task-master-ai'] };
    }

    /**
     * Get the current active tag from state.json or default to 'master'
     */
    private async getCurrentTag(): Promise<string> {
        try {
            const stateFile = path.join(this.projectRoot, '.taskmaster', 'state.json');
            if (fs.existsSync(stateFile)) {
                const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
                return state.currentTag || 'master';
            }
            return this.currentTag;
        } catch (error) {
            log(`Error getting current tag, defaulting to 'master': ${error}`);
            return 'master';
        }
    }

    /**
     * Initialize MCP client connection
     */
    private async initializeConnection(): Promise<void> {
        if (this.isConnected && this.client) {
            return;
        }

        try {
            // Dynamically load MCP SDK
            const { Client, StdioClientTransport } = await loadMCPSDK();
            
            // Create MCP client with basic configuration
            this.client = new Client({
                name: 'task-master-extension',
                version: '1.2.1'
            });

            // Try to find the best task-master-ai command
            const taskMasterCommand = await this.findTaskMasterCommand();
            
            // Create stdio transport for task-master-ai CLI
            const transportOptions = {
                command: taskMasterCommand.command,
                args: [...taskMasterCommand.args, '--mcp'],
                cwd: this.projectRoot, // Back to using project root
                env: {
                    ...process.env,
                    TASKMASTER_PROJECT_ROOT: this.projectRoot,
                    // Try to suppress the FastMCP warning
                    FASTMCP_DEBUG: 'false'
                }
            };
            
            log(`Transport options: ${JSON.stringify(transportOptions, null, 2)}`);
            this.transport = new StdioClientTransport(transportOptions);

            // Connect to the MCP server with timeout and detailed logging
            log(`Attempting to connect to MCP server using: ${taskMasterCommand.command} ${taskMasterCommand.args.join(' ')} --mcp`);
            log(`Working directory: ${this.projectRoot}`);
            
            const connectPromise = this.client.connect(this.transport);
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('MCP connection timeout after 5 seconds')), 5000)
            );
            
            // Add additional error handling
            this.transport.onclose = () => log('MCP transport closed unexpectedly');
            this.transport.onerror = (error: any) => log(`MCP transport error: ${error}`);
            
            await Promise.race([connectPromise, timeoutPromise]);
            this.isConnected = true;
            log('MCP client connected successfully');
        } catch (error) {
            log(`Failed to initialize MCP connection: ${error}`);
            this.isConnected = false;
            throw error;
        }
    }

    /**
     * Check if MCP server is available
     */
    async isAvailable(): Promise<boolean> {
        try {
            await this.initializeConnection();
            if (!this.client) {
                return false;
            }

            // Try to ping the server with timeout
            const pingPromise = this.client.ping();
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('MCP ping timeout')), 3000)
            );
            
            await Promise.race([pingPromise, timeoutPromise]);
            return true;
        } catch (error) {
            log(`MCP server not available: ${error}`);
            this.isConnected = false;
            return false;
        }
    }

    /**
     * Check if MCP SDK can be loaded (without trying to connect)
     */
    async canLoadMCP(): Promise<boolean> {
        // Check if MCP is disabled via environment variable
        if (process.env['CLAUDE_TASK_MASTER_DISABLE_MCP'] === 'true') {
            log('MCP disabled via environment variable CLAUDE_TASK_MASTER_DISABLE_MCP');
            return false;
        }

        // Check if MCP is disabled via VS Code configuration
        try {
            const vscode = require('vscode');
            const config = vscode.workspace.getConfiguration('claudeTaskMaster');
            if (config.get('disableMCP', false)) {
                log('MCP disabled via VS Code configuration');
                return false;
            }
        } catch (error) {
            // VS Code API not available (probably in tests), continue
        }

        try {
            await loadMCPSDK();
            return true;
        } catch (error) {
            log(`MCP SDK not loadable: ${error}`);
            return false;
        }
    }

    /**
     * Generic method to call MCP tools
     */
    private async callMCPTool(toolName: string, parameters: any): Promise<any> {
        try {
            await this.initializeConnection();
            if (!this.client) {
                throw new Error('MCP client not initialized');
            }

            log(`Calling MCP tool: ${toolName} with parameters: ${JSON.stringify(parameters)}`);
            
            const result = await this.client.callTool({
                name: toolName,
                arguments: parameters
            });

            // Extract text content from the result
            if (result.content && Array.isArray(result.content)) {
                const textContent = result.content
                    .filter((item: any) => item.type === 'text')
                    .map((item: any) => item.text)
                    .join('\n');
                
                // Try to parse as JSON if possible
                try {
                    return JSON.parse(textContent);
                } catch {
                    return textContent;
                }
            }

            return result;
        } catch (error) {
            log(`MCP tool call failed: ${toolName} - ${error}`);
            throw error;
        }
    }

    /**
     * Normalize a single task's IDs to strings
     */
    private normalizeTaskId(task: any): Task | null {
        if (!task) {
            return null;
        }

        return {
            ...task,
            id: task.id?.toString() || '', // Convert ID to string
            // Also normalize dependency IDs if they exist
            dependencies: task.dependencies?.map((dep: any) => dep?.toString()) || [],
            // Recursively normalize subtask IDs
            subtasks: task.subtasks ? this.normalizeTaskIds(task.subtasks) : []
        };
    }

    /**
     * Normalize task IDs to strings to ensure compatibility with tree view operations
     * The MCP server might return numeric IDs, but the extension expects string IDs
     */
    private normalizeTaskIds(tasks: any[]): Task[] {
        if (!Array.isArray(tasks)) {
            return [];
        }

        return tasks.map(task => this.normalizeTaskId(task)).filter((task): task is Task => task !== null);
    }

    /**
     * Get all tasks with tag support
     */
    async getTasks(tag?: string): Promise<Task[]> {
        const currentTag = tag || await this.getCurrentTag();
        
        // Try different parameter combinations to see what works
        log(`Trying get_tasks with projectRoot: ${this.projectRoot}, tag: ${currentTag}`);
        let result = await this.callMCPTool('get_tasks', {
            projectRoot: this.projectRoot,
            tag: currentTag,
            withSubtasks: true
        });
        
        log(`First attempt result: ${JSON.stringify(result)}`);
        
        // Check if result is empty (could be null, undefined, empty array, or empty object)
        const isEmpty = (res: any) => {
            if (!res) {return true;}
            if (Array.isArray(res) && res.length === 0) {return true;}
            if (typeof res === 'object' && Object.keys(res).length === 0) {return true;}
            if (res.tagInfo && res.tagInfo.tasks && Array.isArray(res.tagInfo.tasks) && res.tagInfo.tasks.length === 0) {return true;}
            return false;
        };
        
        // If that returns empty, try without projectRoot
        if (isEmpty(result)) {
            log(`First attempt returned empty, trying without projectRoot parameter`);
            result = await this.callMCPTool('get_tasks', {
                tag: currentTag,
                withSubtasks: true
            });
            log(`Second attempt result: ${JSON.stringify(result)}`);
        }
        
        // If still empty, try just with tag
        if (isEmpty(result)) {
            log(`Second attempt returned empty, trying with just tag parameter`);
            result = await this.callMCPTool('get_tasks', {
                tag: currentTag
            });
            log(`Third attempt result: ${JSON.stringify(result)}`);
        }
        
        // If still empty, try with no parameters
        if (isEmpty(result)) {
            log(`Third attempt returned empty, trying with no parameters`);
            result = await this.callMCPTool('get_tasks', {});
            log(`Fourth attempt result: ${JSON.stringify(result)}`);
        }

        // Handle the MCP server response format
        if (result && result.data && result.data.tasks && Array.isArray(result.data.tasks)) {
            log(`Successfully parsed ${result.data.tasks.length} tasks from MCP response`);
            log(`Before normalization - sample task ID type: ${typeof result.data.tasks[0]?.id}`);
            const normalizedTasks = this.normalizeTaskIds(result.data.tasks);
            log(`After normalization - sample task ID type: ${typeof normalizedTasks[0]?.id}`);
            return normalizedTasks;
        }
        
        // Handle the tagged format response (alternative format)
        if (result && result.tagInfo && result.tagInfo.tasks) {
            return this.normalizeTaskIds(result.tagInfo.tasks);
        }
        
        // Fallback for direct tasks array
        const tasks = Array.isArray(result) ? result : [];
        return this.normalizeTaskIds(tasks);
    }

    /**
     * Get a specific task with tag support
     */
    async getTask(taskId: string, tag?: string): Promise<Task | null> {
        const currentTag = tag || await this.getCurrentTag();
        
        const result = await this.callMCPTool('get_task', {
            projectRoot: this.projectRoot,
            id: taskId,
            tag: currentTag
        });

        return this.normalizeTaskId(result);
    }

    /**
     * Get the next task to work on with tag support
     */
    async getNextTask(tag?: string): Promise<Task | null> {
        const currentTag = tag || await this.getCurrentTag();
        
        const result = await this.callMCPTool('next_task', {
            projectRoot: this.projectRoot,
            tag: currentTag
        });

        return this.normalizeTaskId(result);
    }

    /**
     * Set task status with tag support
     */
    async setTaskStatus(taskId: string, status: TaskStatus, tag?: string): Promise<void> {
        const currentTag = tag || await this.getCurrentTag();
        
        await this.callMCPTool('set_task_status', {
            projectRoot: this.projectRoot,
            id: taskId,
            status: this.mapStatusToTaskMaster(status),
            tag: currentTag
        });
    }

    /**
     * Add a new task with tag support
     */
    async addTask(task: Omit<Task, 'id'>, tag?: string): Promise<void> {
        const currentTag = tag || await this.getCurrentTag();
        
        await this.callMCPTool('add_task', {
            projectRoot: this.projectRoot,
            prompt: `Title: ${task.title}\nDescription: ${task.description}\nDetails: ${task.details || ''}`,
            priority: task.priority || 'medium',
            dependencies: task.dependencies?.join(',') || '',
            tag: currentTag
        });
    }

    /**
     * Add a subtask with tag support
     */
    async addSubtask(parentTaskId: string, subtask: Omit<Task, 'id'>, tag?: string): Promise<void> {
        const currentTag = tag || await this.getCurrentTag();
        
        await this.callMCPTool('add_subtask', {
            projectRoot: this.projectRoot,
            id: parentTaskId,
            title: subtask.title,
            description: subtask.description || '',
            details: subtask.details || '',
            dependencies: subtask.dependencies?.join(',') || '',
            status: this.mapStatusToTaskMaster(subtask.status || 'pending'),
            tag: currentTag
        });
    }

    /**
     * Expand a task into subtasks with tag support
     */
    async expandTask(taskId: string, force: boolean = false, tag?: string): Promise<void> {
        const currentTag = tag || await this.getCurrentTag();
        
        await this.callMCPTool('expand_task', {
            projectRoot: this.projectRoot,
            id: taskId,
            force: force,
            tag: currentTag
        });
    }

    /**
     * Update a task with tag support
     */
    async updateTask(taskId: string, prompt: string, tag?: string): Promise<void> {
        const currentTag = tag || await this.getCurrentTag();
        
        await this.callMCPTool('update_task', {
            projectRoot: this.projectRoot,
            id: taskId,
            prompt: prompt,
            tag: currentTag
        });
    }

    /**
     * Update a subtask with tag support
     */
    async updateSubtask(subtaskId: string, prompt: string, tag?: string): Promise<void> {
        const currentTag = tag || await this.getCurrentTag();
        
        await this.callMCPTool('update_subtask', {
            projectRoot: this.projectRoot,
            id: subtaskId,
            prompt: prompt,
            tag: currentTag
        });
    }

    /**
     * Get available tags
     */
    async getTags(): Promise<string[]> {
        try {
            const result = await this.callMCPTool('get_tags', {
                projectRoot: this.projectRoot
            });
            return Array.isArray(result) ? result : ['master'];
        } catch (error) {
            log(`Error getting tags: ${error}`);
            return ['master'];
        }
    }

    /**
     * Switch to a different tag
     */
    async switchTag(tagName: string): Promise<void> {
        try {
            await this.callMCPTool('use_tag', {
                projectRoot: this.projectRoot,
                tag: tagName
            });
            this.currentTag = tagName;
            log(`Switched to tag: ${tagName}`);
        } catch (error) {
            log(`Error switching to tag ${tagName}: ${error}`);
            throw error;
        }
    }

    /**
     * Map extension status values to Task Master status values
     */
    private mapStatusToTaskMaster(status: TaskStatus): string {
        const statusMap: Record<TaskStatus, string> = {
            'todo': 'pending',
            'pending': 'pending',
            'in-progress': 'in-progress', 
            'completed': 'done',
            'done': 'done',
            'blocked': 'blocked',
            'deferred': 'deferred',
            'cancelled': 'cancelled',
            'review': 'review'
        };
        return statusMap[status] || 'pending';
    }

    /**
     * Get tag information including current tag and available tags
     */
    async getTagInfo(): Promise<{ currentTag: string; availableTags: string[] }> {
        try {
            const currentTag = await this.getCurrentTag();
            const availableTags = await this.getTags();
            return { currentTag, availableTags };
        } catch (error) {
            log(`Error getting tag info: ${error}`);
            return { currentTag: 'master', availableTags: ['master'] };
        }
    }

    /**
     * Clean up resources
     */
    async dispose(): Promise<void> {
        try {
            if (this.client && this.isConnected) {
                await this.client.close();
            }
            this.isConnected = false;
            this.client = null;
            this.transport = null;
            log('MCP client disposed');
        } catch (error) {
            log(`Error disposing MCP client: ${error}`);
        }
    }
} 