import * as vscode from 'vscode';
import { TaskMasterClient } from './taskMasterClient';
import { log } from './logger';
import { Task } from './types';

export class TaskItem extends vscode.TreeItem {
    constructor(
        public override readonly label: string,
        public override readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly task?: Task,
        public readonly type?: 'category' | 'task' | 'subtask' | 'progress' | 'next-task',
        public readonly nestingLevel: number = 0,
        public readonly parentTaskId?: string,  // Add parent task ID for subtasks
        public readonly tagContext?: { currentTag: string; isTaggedFormat: boolean; availableTags: string[] }  // Add tag context
    ) {
        super(label, collapsibleState);
        
        if (task) {
            // Set context value based on type for proper menu options
            this.contextValue = type === 'subtask' ? 'subtask' : 'task';
            this.tooltip = this.generateTooltip(task);
            
            // Only generate description for main tasks, not subtasks (to avoid clutter)
            if (type !== 'subtask') {
            this.description = this.generateDescription(task);
            }
            
            this.iconPath = this.getTaskIcon(task);
            
            // Add visual indentation based on nesting level
            if (nestingLevel > 0) {
                const indent = '  '.repeat(nestingLevel); // 2 spaces per level
                // Use different connectors based on depth and status
                let connector = '';
                const statusEmoji = this.getStatusEmoji(task.status);
                
                if (nestingLevel === 1) {
                    connector = '├─ ';
                } else if (nestingLevel === 2) {
                    connector = '└── ';
                } else {
                    connector = '└─── '; // Even deeper nesting
                }
                
                // For subtasks, preserve the hierarchical label format from TaskProvider
                if (type === 'subtask') {
                    this.label = `${indent}${connector}${statusEmoji} ${this.label}`;
                } else {
                this.label = `${indent}${connector}${statusEmoji} ${task.id}: ${task.title}`;
                }
            } else {
                const statusEmoji = this.getStatusEmoji(task.status);
                // For subtasks, preserve the hierarchical label format from TaskProvider
                if (type === 'subtask') {
                    this.label = `${statusEmoji} ${this.label}`;
                } else {
                this.label = `${statusEmoji} ${task.id}: ${task.title}`;
                }
            }
            
            // Updated command to include parent task ID for subtasks
            this.command = {
                command: 'claudeTaskMaster.showTask',
                title: 'Show Task Details',
                arguments: [this, parentTaskId] // Pass parent task ID as second argument
            };
        } else if (type === 'category') {
            this.contextValue = 'category';
            this.iconPath = new vscode.ThemeIcon('folder');
        } else if (type === 'progress') {
            this.contextValue = 'progress';
            this.iconPath = new vscode.ThemeIcon('graph');
        }
    }

    private generateTooltip(task: Task): string {
        let tooltip = `${task.title}\n\nStatus: ${task.status}`;
        
        // Add tag information if available
        if (this.tagContext?.isTaggedFormat) {
            tooltip += `\nTag: ${this.tagContext.currentTag}`;
            if (this.tagContext.availableTags.length > 1) {
                tooltip += ` (${this.tagContext.availableTags.length} tags available)`;
            }
        }
        
        if (task.priority) {
            tooltip += `\nPriority: ${task.priority}`;
        }
        
        if (task.description) {
            tooltip += `\nDescription: ${task.description}`;
        }
        
        if (task.dependencies && task.dependencies.length > 0) {
            tooltip += `\nDependencies: ${task.dependencies.join(', ')}`;
        }
        
        if (task.dueDate) {
            tooltip += `\nDue: ${task.dueDate}`;
        }
        
        // Add subtask information to tooltip
        if (task.subtasks && task.subtasks.length > 0) {
            const completedSubtasks = task.subtasks.filter(subtask => 
                subtask.status === 'completed' || subtask.status === 'done'
            ).length;
            tooltip += `\n\n📋 Subtasks: ${completedSubtasks}/${task.subtasks.length} completed`;
            tooltip += `\n💡 Click the arrow to expand/collapse subtasks`;
        }
        
        return tooltip;
    }

    private generateDescription(task: Task): string {
        const parts: string[] = [];
        
        // Tag indicator for tagged format (only show if multiple tags available)
        if (this.tagContext?.isTaggedFormat && this.tagContext.availableTags.length > 1) {
            parts.push(`🏷️[${this.tagContext.currentTag}]`);
        }
        
        // Priority indicator with emoji
        if (task.priority) {
            const priorityEmoji = this.getPriorityEmoji(task.priority);
            parts.push(`${priorityEmoji}[${task.priority.toUpperCase()}]`);
        }
        
        // Dependencies with status indicators
        if (task.dependencies && task.dependencies.length > 0) {
            const depStatus = this.getDependencyStatusIndicator(task.dependencies);
            parts.push(`${depStatus} ${task.dependencies.length} deps`);
        }
        
        // Subtasks with progress indicator and dropdown hint
        if (task.subtasks && task.subtasks.length > 0) {
            const completedSubtasks = task.subtasks.filter(subtask => 
                subtask.status === 'completed' || subtask.status === 'done'
            ).length;
            const progressEmoji = completedSubtasks === task.subtasks.length ? '✅' : 
                                 completedSubtasks > 0 ? '🔄' : '📝';
            // Add dropdown arrow to indicate expandable content
            parts.push(`${progressEmoji} ${completedSubtasks}/${task.subtasks.length} ▶`);
        }
        
        return parts.join(' ');
    }

    private getPriorityEmoji(priority: string): string {
        switch (priority.toLowerCase()) {
            case 'high':
            case 'critical':
                return '🔴';
            case 'medium':
                return '🟡';
            case 'low':
                return '🟢';
            default:
                return '⚪';
        }
    }

    private getDependencyStatusIndicator(_dependencies: string[]): string {
        // For now, we'll use a generic indicator
        // In a real implementation, you'd check if dependencies are completed
        return '⏱️'; // Assuming pending dependencies for now
    }

    private getStatusEmoji(status: string): string {
        switch (status) {
            case 'completed':
            case 'done':
                return '✅';
            case 'in-progress':
                return '🔄';
            case 'blocked':
                return '❌';
            case 'deferred':
                return '⏰';
            case 'cancelled':
                return '❌';
            case 'review':
                return '👁️';
            case 'todo':
            case 'pending':
            default:
                return '⭕';
        }
    }

    private getTaskIcon(task: Task): vscode.ThemeIcon {
        // Check if task has subtasks to use different icons
        const hasSubtasks = task.subtasks && task.subtasks.length > 0;
        
        // For tagged format with multiple tags, add subtle visual distinction
        const isMultiTaggedFormat = this.tagContext?.isTaggedFormat && this.tagContext.availableTags.length > 1;
        
        switch (task.status) {
            case 'completed':
            case 'done':
                if (hasSubtasks) {
                    return new vscode.ThemeIcon('checklist', new vscode.ThemeColor('charts.green'));
                }
                // Use different icon for tagged tasks to provide visual distinction
                if (isMultiTaggedFormat) {
                    return new vscode.ThemeIcon('verified-filled', new vscode.ThemeColor('charts.green'));
                }
                return new vscode.ThemeIcon('check-all', new vscode.ThemeColor('charts.green'));
                
            case 'in-progress':
                if (hasSubtasks) {
                    return new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.blue'));
                }
                // Use different icon for tagged tasks to provide visual distinction
                if (isMultiTaggedFormat) {
                    return new vscode.ThemeIcon('play-circle', new vscode.ThemeColor('charts.blue'));
                }
                return new vscode.ThemeIcon('play', new vscode.ThemeColor('charts.blue'));
                
            case 'blocked':
                return new vscode.ThemeIcon('stop-circle', new vscode.ThemeColor('charts.red'));
                
            case 'deferred':
                return new vscode.ThemeIcon('clock', new vscode.ThemeColor('charts.orange'));
                
            case 'cancelled':
                return new vscode.ThemeIcon('x', new vscode.ThemeColor('charts.red'));
                
            case 'review':
                return new vscode.ThemeIcon('eye', new vscode.ThemeColor('charts.purple'));
                
            case 'todo':
            case 'pending':
            default:
                if (hasSubtasks) {
                    return new vscode.ThemeIcon('list-tree', new vscode.ThemeColor('charts.yellow'));
                }
                return new vscode.ThemeIcon('circle-large-outline', new vscode.ThemeColor('charts.yellow'));
        }
    }
}

export class TaskProvider implements vscode.TreeDataProvider<TaskItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<TaskItem | undefined | null | void> = new vscode.EventEmitter<TaskItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<TaskItem | undefined | null | void> = this._onDidChangeTreeData.event;

    // Track expanded items by their unique key
    private expandedItems: Set<string> = new Set();
    private allExpanded: boolean = false;
    
    // Tag context support
    private currentTag: string = 'master';
    private availableTags: string[] = ['master'];
    private isTaggedFormat: boolean = false;
    
    // Debouncing for frequent refresh calls
    private refreshTimeout: NodeJS.Timeout | null = null;
    private readonly REFRESH_DEBOUNCE_MS = 300; // 300ms debounce

    constructor(private taskMasterClient: TaskMasterClient) {
        log('TaskProvider constructed.');
        this.initializeTagContext();
    }

    /**
     * Initialize tag context from TaskMasterClient
     */
    private initializeTagContext(): void {
        try {
            const tagContext = this.taskMasterClient.getTagContext();
            this.currentTag = tagContext.currentTag;
            this.availableTags = tagContext.availableTags;
            this.isTaggedFormat = tagContext.isTaggedFormat;
            log(`TaskProvider initialized with tag context: currentTag=${this.currentTag}, availableTags=[${this.availableTags.join(', ')}], isTaggedFormat=${this.isTaggedFormat}`);
        } catch (error) {
            log(`Failed to initialize tag context, using defaults: ${error}`);
            this.currentTag = 'master';
            this.availableTags = ['master'];
            this.isTaggedFormat = false;
        }
    }

    /**
     * Get current tag context
     */
    getTagContext(): { currentTag: string; availableTags: string[]; isTaggedFormat: boolean } {
        return {
            currentTag: this.currentTag,
            availableTags: this.availableTags,
            isTaggedFormat: this.isTaggedFormat
        };
    }

    /**
     * Switch to a different tag context
     */
    async switchTag(tagName: string): Promise<void> {
        try {
            log(`TaskProvider switching from tag '${this.currentTag}' to '${tagName}'`);
            
            // Update tag context via TaskMasterClient
            await this.taskMasterClient.switchTag(tagName);
            
            // Update local tag context
            this.currentTag = tagName;
            
            // Refresh tag context from client to ensure consistency
            const tagContext = this.taskMasterClient.getTagContext();
            this.availableTags = tagContext.availableTags;
            this.isTaggedFormat = tagContext.isTaggedFormat;
            
            log(`TaskProvider successfully switched to tag '${tagName}'`);
            
            // Use immediate refresh for tag switching to provide instant feedback
            this.refreshImmediate();
        } catch (error) {
            log(`Failed to switch to tag '${tagName}': ${error}`);
            throw error;
        }
    }

    /**
     * Refresh tag context and tree view
     */
    refreshTagContext(): void {
        log('TaskProvider refreshing tag context');
        this.initializeTagContext();
        this.refresh();
    }

    refresh(): void {
        log('TaskProvider.refresh called.');
        this.debouncedRefresh();
    }

    /**
     * Debounced refresh to prevent excessive tree updates during frequent tag changes
     */
    private debouncedRefresh(): void {
        // Clear existing timeout
        if (this.refreshTimeout) {
            clearTimeout(this.refreshTimeout);
        }

        // Set new timeout
        this.refreshTimeout = setTimeout(() => {
            this.performRefresh();
            this.refreshTimeout = null;
        }, this.REFRESH_DEBOUNCE_MS);
    }

    /**
     * Immediate refresh without debouncing (for critical updates)
     */
    refreshImmediate(): void {
        log('TaskProvider.refreshImmediate called.');
        // Clear any pending debounced refresh
        if (this.refreshTimeout) {
            clearTimeout(this.refreshTimeout);
            this.refreshTimeout = null;
        }
        this.performRefresh();
    }

    /**
     * Perform the actual refresh operation
     */
    private performRefresh(): void {
        const timestamp = new Date().toISOString();
        log(`🔄 TREE REFRESH [${timestamp}] - Tree data provider refreshed for tag: ${this.currentTag}`);
        
        // Update tag context before refreshing to ensure we have the latest information
        try {
            const tagContext = this.taskMasterClient.getTagContext();
            this.currentTag = tagContext.currentTag;
            this.availableTags = tagContext.availableTags;
            this.isTaggedFormat = tagContext.isTaggedFormat;
        } catch (error) {
            log(`Warning: Could not update tag context during refresh: ${error}`);
        }
        
        this._onDidChangeTreeData.fire();
    }

    // Method to expand all items
    expandAll(): void {
        log('TaskProvider.expandAll called.');
        const timestamp = new Date().toISOString();
        log(`📈 EXPAND ALL [${timestamp}] - Setting all items to expanded state`);
        this.allExpanded = true;
        this.expandedItems.clear(); // Clear individual tracking when all expanded
        log(`📈 EXPAND ALL [${timestamp}] - Internal state updated, triggering refresh`);
        this.refresh();
    }

    // Method to collapse all items
    collapseAll(): void {
        log('TaskProvider.collapseAll called.');
        this.allExpanded = false;
        this.expandedItems.clear();
        this.refresh();
    }

    // Method to toggle expansion state of an item
    toggleExpansion(itemKey: string): void {
        log(`TaskProvider.toggleExpansion called for key: ${itemKey}`);
        
        if (this.expandedItems.has(itemKey)) {
            this.expandedItems.delete(itemKey);
            log(`  Collapsing section: ${itemKey}`);
        } else {
            this.expandedItems.add(itemKey);
            log(`  Expanding section: ${itemKey}`);
        }

        // If a specific item is toggled, we are no longer in a global "all expanded" state
        if (this.allExpanded) {
            this.allExpanded = false;
        }

        this.refresh();
    }

    // Helper to determine if an item should be expanded
    private isExpanded(itemKey: string): boolean {
        if (this.allExpanded) {
            // log(`isExpanded: allExpanded is true, returning true for ${itemKey}`);
            return true;
        }
        const result = this.expandedItems.has(itemKey);
        // log(`isExpanded: item ${itemKey} is in expandedItems: ${result}`);
        return result;
    }

    // Helper to create a unique key for an item
    private getItemKey(type: string, label: string, id?: string): string {
        return `${type}:${id || label}`;
    }

    getTreeItem(element: TaskItem): vscode.TreeItem {
        log(`getTreeItem called for: ${element.label}`);
        return element;
    }

    /**
     * REQUIRED for TreeView.reveal() API used in expandAll functionality.
     * While TypeScript marks this as optional, VS Code runtime requires it for reveal operations.
     * 
     * @param element The tree item to get the parent for
     * @returns The parent item or null for root-level items
     */
    getParent(element: TaskItem): TaskItem | null {
        // For root level items and categories, no parent
        if (!element.task || element.type === 'category' || element.type === 'progress' || element.type === 'next-task') {
            return null;
        }

        // For subtasks, return null since they're already nested under their parent in getChildren
        // VS Code will handle the hierarchy through the TreeItem structure
        return null;
    }

    async getChildren(element?: TaskItem): Promise<TaskItem[]> {
        log(`getChildren called for element: ${element?.label || 'root'}`);
        
        if (!this.taskMasterClient || !this.taskMasterClient.hasTaskmaster()) {
            log('TaskMasterClient not available or no taskmaster directory. Returning empty array.');
            return [];
        }

        if (!element) {
            // Root level - show categories and progress
            log('Getting root items...');
            const rootItems = await this.getRootItems();
            log(`Root items count: ${rootItems.length}`);
            return rootItems;
        }

        if (element.type === 'category') {
            log(`Getting tasks for category: ${element.label}`);
            return this.getTasksByCategory(element.label);
        }

        if (element.type === 'progress') {
            log('Getting progress items...');
            return this.getProgressItems();
        }

        // Handle tasks with subtasks
        if (element.task && element.task.subtasks && element.task.subtasks.length > 0) {
            log(`Getting subtasks for task: ${element.task.id}`);
            
            // Check if we need to filter subtasks based on parent category context
            let subtasksToShow = element.task.subtasks;
            
            // If this task item has a contextValue indicating it's from a specific section,
            // filter subtasks accordingly
            if (element.contextValue === 'completed-section') {
                // Only show completed subtasks in the completed section
                subtasksToShow = element.task.subtasks.filter(subtask => 
                    subtask.status === 'completed' || subtask.status === 'done'
                );
                log(`Filtering to show only completed subtasks: ${subtasksToShow.length}/${element.task.subtasks.length}`);
            }
            
            return subtasksToShow.map(subtask => {
                let collapsibleState = vscode.TreeItemCollapsibleState.None;
                if (subtask.subtasks && subtask.subtasks.length > 0) {
                    const itemKey = this.getItemKey('subtask', subtask.id, subtask.id);
                    const isExpanded = this.isExpanded(itemKey);
                    collapsibleState = isExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
                }
                
                // Calculate nesting level based on parent's level
                const nestingLevel = element.nestingLevel + 1;
                
                // Create subtask item with proper nesting and status display
                const subtaskItem = new TaskItem(
                    `${subtask.id}: ${subtask.title}`, // Cleaner display without redundant parent ID
                    collapsibleState,
                    subtask,
                    'subtask', // Use specific type for subtasks
                    nestingLevel,
                    element.task?.id.toString(), // Pass parent task ID for subtasks
                    this.getTagContext() // Pass tag context for tag-aware display
                );
                
                // Add status and progress info as description for clear visibility
                let description = `[${subtask.status.toUpperCase()}]`;
                if (subtask.priority) {
                    description += ` ${this.getPriorityEmoji(subtask.priority)}`;
                }
                if (subtask.subtasks && subtask.subtasks.length > 0) {
                    const completed = subtask.subtasks.filter(st => 
                        st.status === 'completed' || st.status === 'done'
                    ).length;
                    description += ` ${completed}/${subtask.subtasks.length} ${this.getDropdownIndicator(false)}`;
                }
                subtaskItem.description = description;
                
                return subtaskItem;
            });
        }

        log(`No children to return for element: ${element.label}`);
        return [];
    }

    private async getTasks(): Promise<Task[]> {
        log('Fetching tasks from TaskMasterClient.');
        const tasks = await this.taskMasterClient.getTasks();
        log(`Fetched ${tasks.length} tasks.`);
        if (tasks.length > 0) {
            log(`First task ID type: ${typeof tasks[0]?.id}, value: ${tasks[0]?.id}`);
        }
        return tasks;
    }

    private async getRootItems(): Promise<TaskItem[]> {
        const items: TaskItem[] = [];
        
        try {
            log('getRootItems: Fetching tasks...');
            const tasks = await this.getTasks();
            log(`getRootItems: Loaded ${tasks.length} tasks.`);
            
            // Add tag context indicator if using tagged format
            if (this.isTaggedFormat && this.availableTags.length > 1) {
                log(`getRootItems: Adding tag context indicator for tag '${this.currentTag}'`);
                const tagItem = new TaskItem(
                    `🏷️ Tag: ${this.currentTag}`,
                    vscode.TreeItemCollapsibleState.None
                );
                tagItem.description = `${this.availableTags.length} tags available • Click to switch`;
                tagItem.iconPath = new vscode.ThemeIcon('tag', new vscode.ThemeColor('charts.purple'));
                tagItem.command = {
                    command: 'claudeTaskMaster.switchTag',
                    title: 'Switch Tag',
                    arguments: []
                };
                items.push(tagItem);
            }
            
            if (tasks.length === 0) {
                log('getRootItems: No tasks found, showing empty state with quick actions.');
                
                // Main empty message
                const emptyMessage = this.isTaggedFormat ? 
                    `No tasks found in tag '${this.currentTag}'` : 
                    'No tasks found';
                const emptyDescription = this.isTaggedFormat ? 
                    'Switch tags or create tasks to get started' : 
                    'Create tasks to get started';
                    
                const emptyItem = new TaskItem(
                    emptyMessage,
                    vscode.TreeItemCollapsibleState.None
                );
                emptyItem.description = emptyDescription;
                emptyItem.iconPath = new vscode.ThemeIcon('info');
                items.push(emptyItem);

                // Quick action: Add Task
                const addTaskItem = new TaskItem(
                    '➕ Add New Task',
                    vscode.TreeItemCollapsibleState.None
                );
                addTaskItem.description = 'Create your first task';
                addTaskItem.iconPath = new vscode.ThemeIcon('add', new vscode.ThemeColor('charts.green'));
                addTaskItem.command = {
                    command: 'claudeTaskMaster.addTask',
                    title: 'Add Task',
                    arguments: []
                };
                items.push(addTaskItem);

                // Quick action: Switch Tag (only for tagged format with multiple tags)
                if (this.isTaggedFormat && this.availableTags.length > 1) {
                    const switchTagItem = new TaskItem(
                        '🏷️ Switch to Different Tag',
                        vscode.TreeItemCollapsibleState.None
                    );
                    switchTagItem.description = `${this.availableTags.length - 1} other tags available`;
                    switchTagItem.iconPath = new vscode.ThemeIcon('tag', new vscode.ThemeColor('charts.purple'));
                    switchTagItem.command = {
                        command: 'claudeTaskMaster.switchTag',
                        title: 'Switch Tag',
                        arguments: []
                    };
                    items.push(switchTagItem);
                }

                // Quick action: Create Tag (only for tagged format)
                if (this.isTaggedFormat) {
                    const createTagItem = new TaskItem(
                        '🆕 Create New Tag',
                        vscode.TreeItemCollapsibleState.None
                    );
                    createTagItem.description = 'Create a new tag context';
                    createTagItem.iconPath = new vscode.ThemeIcon('plus', new vscode.ThemeColor('charts.blue'));
                    createTagItem.command = {
                        command: 'claudeTaskMaster.createTag',
                        title: 'Create Tag',
                        arguments: []
                    };
                    items.push(createTagItem);
                }

                return items;
            }

            // Current task (in-progress tasks)
            log('getRootItems: Getting current tasks (in-progress)...');
            const currentTasks = tasks.filter(task => task.status === 'in-progress');
            const currentSubtasks = tasks.flatMap(task => 
                task.subtasks?.filter(subtask => subtask.status === 'in-progress') || []
            );
            log(`getRootItems: Found ${currentTasks.length} current tasks and ${currentSubtasks.length} current subtasks.`);
            
            if (currentTasks.length > 0 || currentSubtasks.length > 0) {
                // Add Current Task Section Header
                const currentHeaderKey = this.getItemKey('category', 'CURRENT WORK');
                const currentIsExpanded = this.isExpanded(currentHeaderKey);
                const currentHeaderItem = new TaskItem(
                    '📝 CURRENT WORK',
                    currentIsExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
                    undefined,
                    'category'
                );
                currentHeaderItem.iconPath = new vscode.ThemeIcon('play-circle', new vscode.ThemeColor('charts.blue'));
                
                // Set description based on what's in progress
                if (currentSubtasks.length > 0) {
                    const firstSubtask = currentSubtasks[0];
                    currentHeaderItem.description = `Working on subtask ${firstSubtask?.id}`;
                } else if (currentTasks.length > 0) {
                    const firstTask = currentTasks[0];
                    currentHeaderItem.description = `Working on task ${firstTask?.id}`;
                }
                
                items.push(currentHeaderItem);
            }

            // Next task recommendation section header
            log('getRootItems: Getting next task recommendation...');
            const nextTask = await this.getNextRecommendedTask(tasks);
            if (nextTask) {
                log(`getRootItems: Next task found: ${nextTask.id}`);
                
                // Add Next Task Section Header
                const nextHeaderKey = this.getItemKey('category', 'NEXT TO WORK ON');
                const nextIsExpanded = this.isExpanded(nextHeaderKey);
                const nextHeaderItem = new TaskItem(
                    '🎯 NEXT TO WORK ON',
                    nextIsExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
                    undefined,
                    'category'
                );
                nextHeaderItem.iconPath = new vscode.ThemeIcon('target', new vscode.ThemeColor('charts.orange'));
                nextHeaderItem.description = 'Recommended next task based on dependencies';
                items.push(nextHeaderItem);
            } else {
                log('getRootItems: No next task found.');
            }

            // Progress overview with visual indicators (using main tasks for primary display)
            log('getRootItems: Getting task progress...');
            const progress = await this.taskMasterClient.getTaskProgress();
            log(`getRootItems: Progress data: ${JSON.stringify(progress)}`);
            const completedPercentage = progress.mainTasks.total > 0 ? Math.round((progress.mainTasks.completed / progress.mainTasks.total) * 100) : 0;
            const progressBar = this.generateProgressBar(completedPercentage);
            
            const itemKey = this.getItemKey('progress', 'Progress Overview');
            const isExpanded = this.isExpanded(itemKey);
            const progressItem = new TaskItem(
                `📊 Progress Overview ${progressBar}`,
                isExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
                undefined,
                'progress'
            );
            progressItem.description = `${completedPercentage}% (${progress.mainTasks.completed}/${progress.mainTasks.total} tasks)`;
            items.push(progressItem);

            // Group by status
            log('getRootItems: Grouping tasks by status...');
            const statusGroups = this.groupTasksByStatus(tasks);
            log(`getRootItems: Status groups: ${Object.keys(statusGroups).map(k => `${k}: ${statusGroups[k]?.length || 0}`).join(', ')}`);
            
            for (const [status, statusTasks] of Object.entries(statusGroups)) {
                if (statusTasks && statusTasks.length > 0) {
                    const statusEmoji = this.getStatusEmojiForProvider(status);
                    const itemKey = this.getItemKey('category', status);
                    const isExpanded = this.isExpanded(itemKey);
                    const statusItem = new TaskItem(
                        `${statusEmoji} ${this.capitalizeFirst(status.replace('-', ' '))} (${statusTasks.length})`,
                        isExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
                        undefined,
                        'category'
                    );
                    statusItem.iconPath = this.getStatusIcon(status);
                    items.push(statusItem);
                }
            }

            // Group by priority if there are priority tasks
            const priorityTasks = tasks.filter(task => task.priority);
            if (priorityTasks.length > 0) {
                log(`getRootItems: Adding priority grouping for ${priorityTasks.length} tasks.`);
                const itemKey = this.getItemKey('category', 'By Priority');
                const isExpanded = this.isExpanded(itemKey);
                const priorityItem = new TaskItem(
                    'By Priority',
                    isExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
                    undefined,
                    'category'
                );
                priorityItem.iconPath = new vscode.ThemeIcon('star');
                items.push(priorityItem);
            }

            // Group by category if there are categorized tasks
            const categorizedTasks = tasks.filter(task => task.category);
            if (categorizedTasks.length > 0) {
                log(`getRootItems: Adding category grouping for ${categorizedTasks.length} tasks.`);
                const itemKey = this.getItemKey('category', 'By Category');
                const isExpanded = this.isExpanded(itemKey);
                const categoryItem = new TaskItem(
                    'By Category',
                    isExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
                    undefined,
                    'category'
                );
                categoryItem.iconPath = new vscode.ThemeIcon('tag');
                items.push(categoryItem);
            }

            log(`getRootItems: Total root items created: ${items.length}`);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log(`Error getting root items: ${errorMessage}`);
            const errorItem = new TaskItem(
                'Error loading tasks',
                vscode.TreeItemCollapsibleState.None
            );
            errorItem.description = 'Check console for details';
            errorItem.iconPath = new vscode.ThemeIcon('error');
            items.push(errorItem);
        }

        return items;
    }

    private async getTasksByCategory(categoryLabel: string): Promise<TaskItem[]> {
        const tasks = await this.getTasks();
        log(`getTasksByCategory called with label: '${categoryLabel}'. Total tasks: ${tasks.length}`);
        let filteredTasks: Task[] = [];
        
        // Normalize category label for case-insensitive comparisons
        const normalizedLabel = categoryLabel.toLowerCase();
        
        // Handle special sections
        if (normalizedLabel.includes('current work')) {
            // Show proper hierarchy for current work - main tasks with their current subtasks
            const currentTasks = tasks.filter(task => task.status === 'in-progress');
            const tasksWithCurrentSubtasks = tasks.filter(task => 
                task.subtasks?.some(subtask => subtask.status === 'in-progress')
            );
            
            const allRelevantTasks = new Set([...currentTasks, ...tasksWithCurrentSubtasks]);
            log(`Current work: Found ${currentTasks.length} current tasks, ${tasksWithCurrentSubtasks.length} tasks with current subtasks (${allRelevantTasks.size} unique tasks total)`);
            
            return Array.from(allRelevantTasks).map(task => {
                // Set collapsible state if task has in-progress subtasks
                let collapsibleState = vscode.TreeItemCollapsibleState.None;
                const hasCurrentSubtasks = task.subtasks?.some(subtask => subtask.status === 'in-progress');
                
                if (hasCurrentSubtasks) {
                    const itemKey = this.getItemKey('task', task.id, task.id);
                    const isExpanded = this.isExpanded(itemKey);
                    collapsibleState = isExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
                }
                
                const currentItem = new TaskItem(
                    `${task.id}: ${task.title}`,
                    collapsibleState,
                    task,
                    'task',
                    0 // Main tasks always at root level
                );
                currentItem.iconPath = new vscode.ThemeIcon('play', new vscode.ThemeColor('charts.blue'));
                currentItem.description = `[IN-PROGRESS] Priority: ${task.priority?.toUpperCase() || 'MEDIUM'}`;
                
                return currentItem;
            });
        } else if (normalizedLabel.includes('next to work on')) {
            // Return the next recommended task when section is expanded
            const nextTask = await this.getNextRecommendedTask(tasks);
            if (nextTask) {
                // Determine if this is a task or subtask by checking if it's actually nested under another task
                let parentTaskId: string | undefined;
                let isSubtask = false;
                
                // Find the parent task for this potential subtask
                const parentTask = tasks.find(task => 
                    task.subtasks?.some(st => st.id === nextTask.id)
                );
                
                if (parentTask) {
                    isSubtask = true;
                    parentTaskId = parentTask.id.toString();
                }
                
                const taskType = isSubtask ? 'Subtask' : 'Task';
                
                const nextTaskItem = new TaskItem(
                    `${taskType} ${nextTask.id}: ${nextTask.title}`,
                    vscode.TreeItemCollapsibleState.None,
                    nextTask,
                    isSubtask ? 'subtask' : 'task',
                    0, // Nesting level for next task display
                    parentTaskId, // Pass parent task ID if this is a subtask
                    this.getTagContext() // Pass tag context for tag-aware display
                );
                nextTaskItem.iconPath = new vscode.ThemeIcon('arrow-right', new vscode.ThemeColor('charts.orange'));
                
                if (isSubtask) {
                    const parentTask = tasks.find(task => 
                        task.subtasks?.some(st => st.id === nextTask.id)
                    );
                    nextTaskItem.description = `[READY] Part of Task ${parentTask?.id}`;
                } else {
                    nextTaskItem.description = `[READY] Priority: ${nextTask.priority?.toUpperCase() || 'MEDIUM'}`;
                }
                nextTaskItem.contextValue = 'next-task';
                
                return [nextTaskItem];
            }
            return [];
        } else if (normalizedLabel.includes('progress overview')) {
            // Return progress items for the Progress Overview section
            return this.getProgressItems();
        }

        if (normalizedLabel.includes('todo')) {
            // Show main tasks that are todo/pending, or have todo/pending subtasks
            const todoTasks = tasks.filter(task => task.status === 'todo' || task.status === 'pending');
            const tasksWithTodoSubtasks = tasks.filter(task => 
                task.subtasks?.some(subtask => subtask.status === 'todo' || subtask.status === 'pending') &&
                !todoTasks.includes(task) // Don't duplicate already todo main tasks
            );
            filteredTasks = [...todoTasks, ...tasksWithTodoSubtasks];
            log(`Filtered for 'Todo': ${filteredTasks.length} tasks (${todoTasks.length} main + ${tasksWithTodoSubtasks.length} tasks with todo subtasks).`);
        } else if (normalizedLabel.includes('in progress')) {
            log(`Filtering for In progress. Total tasks: ${tasks.length}`);
            
            // Show main tasks that are in-progress, or have in-progress subtasks
            const inProgressTasks = tasks.filter(task => task.status === 'in-progress');
            const tasksWithInProgressSubtasks = tasks.filter(task => 
                task.subtasks?.some(subtask => subtask.status === 'in-progress') &&
                !inProgressTasks.includes(task) // Don't duplicate already in-progress main tasks
            );
            
            filteredTasks = [...inProgressTasks, ...tasksWithInProgressSubtasks];
            log(`Filtered for category '${categoryLabel}': ${filteredTasks.length} tasks (${inProgressTasks.length} main tasks + ${tasksWithInProgressSubtasks.length} tasks with in-progress subtasks).`);
            filteredTasks.forEach(task => log(`In progress item: ${task.id} - ${task.title}`));
        } else if (normalizedLabel.includes('completed')) {
            // Show completed main tasks with proper hierarchy, not a flat list
            const completedTasks = tasks.filter(task => task.status === 'completed' || task.status === 'done');
            
            // Also include main tasks that have completed subtasks (even if the main task isn't completed)
            const tasksWithCompletedSubtasks = tasks.filter(task => 
                task.subtasks?.some(subtask => subtask.status === 'completed' || subtask.status === 'done') &&
                !completedTasks.includes(task) // Don't duplicate already completed main tasks
            );
            
            const allRelevantTasks = [...completedTasks, ...tasksWithCompletedSubtasks];
            log(`Completed section: Found ${completedTasks.length} completed main tasks, ${tasksWithCompletedSubtasks.length} tasks with completed subtasks (${allRelevantTasks.length} total)`);
            
            return allRelevantTasks.map(task => {
                // Set collapsible state if task has any subtasks (completed or not)
                let collapsibleState = vscode.TreeItemCollapsibleState.None;
                if (task.subtasks && task.subtasks.length > 0) {
                    const itemKey = this.getItemKey('task', task.id, task.id);
                    const isExpanded = this.isExpanded(itemKey);
                    collapsibleState = isExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
                }
                
                log(`Creating completed TaskItem for ${task.id}: ${task.title} (status: ${task.status}, collapsible: ${collapsibleState})`);
                
                const taskItem = new TaskItem(
                    `${task.id}: ${task.title}`,
                    collapsibleState,
                    task,
                    'task',
                    0, // Main tasks always at root level in category
                    undefined, // No parent task ID for main tasks
                    this.getTagContext() // Pass tag context for tag-aware display
                );
                
                // Set context value so getChildren knows this is from completed section
                taskItem.contextValue = 'completed-section';
                
                return taskItem;
            });
        } else if (normalizedLabel.includes('blocked')) {
            // Show main tasks that are blocked, or have blocked subtasks
            const blockedTasks = tasks.filter(task => task.status === 'blocked');
            const tasksWithBlockedSubtasks = tasks.filter(task => 
                task.subtasks?.some(subtask => subtask.status === 'blocked') &&
                !blockedTasks.includes(task) // Don't duplicate already blocked main tasks
            );
            filteredTasks = [...blockedTasks, ...tasksWithBlockedSubtasks];
            log(`Filtered for 'Blocked': ${filteredTasks.length} tasks (${blockedTasks.length} main + ${tasksWithBlockedSubtasks.length} tasks with blocked subtasks).`);
        } else if (normalizedLabel.includes('deferred')) {
            // Show main tasks that are deferred, or have deferred subtasks
            const deferredTasks = tasks.filter(task => task.status === 'deferred');
            const tasksWithDeferredSubtasks = tasks.filter(task => 
                task.subtasks?.some(subtask => subtask.status === 'deferred') &&
                !deferredTasks.includes(task) // Don't duplicate already deferred main tasks
            );
            filteredTasks = [...deferredTasks, ...tasksWithDeferredSubtasks];
            log(`Filtered for 'Deferred': ${filteredTasks.length} tasks (${deferredTasks.length} main + ${tasksWithDeferredSubtasks.length} tasks with deferred subtasks).`);
        } else if (normalizedLabel.includes('cancelled')) {
            // Show main tasks that are cancelled, or have cancelled subtasks
            const cancelledTasks = tasks.filter(task => task.status === 'cancelled');
            const tasksWithCancelledSubtasks = tasks.filter(task => 
                task.subtasks?.some(subtask => subtask.status === 'cancelled') &&
                !cancelledTasks.includes(task) // Don't duplicate already cancelled main tasks
            );
            filteredTasks = [...cancelledTasks, ...tasksWithCancelledSubtasks];
            log(`Filtered for 'Cancelled': ${filteredTasks.length} tasks (${cancelledTasks.length} main + ${tasksWithCancelledSubtasks.length} tasks with cancelled subtasks).`);
        } else if (normalizedLabel.includes('review')) {
            // Show main tasks that are in review, or have subtasks in review
            const reviewTasks = tasks.filter(task => task.status === 'review');
            const tasksWithReviewSubtasks = tasks.filter(task => 
                task.subtasks?.some(subtask => subtask.status === 'review') &&
                !reviewTasks.includes(task) // Don't duplicate already review main tasks
            );
            filteredTasks = [...reviewTasks, ...tasksWithReviewSubtasks];
            log(`Filtered for 'Review': ${filteredTasks.length} tasks (${reviewTasks.length} main + ${tasksWithReviewSubtasks.length} tasks with review subtasks).`);
        } else if (normalizedLabel.includes('by priority')) {
            log('Filtering by priority groups.');
            return this.getTasksByPriorityGroups(tasks);
        } else if (normalizedLabel === 'by category') {
            log('Filtering by category groups.');
            return this.getTasksByCategoryGroups(tasks);
        } else if (normalizedLabel.includes('priority')) {
            // Handle specific priority groups like "🔴 High Priority (3)"
            let priority = '';
            if (normalizedLabel.includes('critical priority')) {
                priority = 'critical';
            } else if (normalizedLabel.includes('high priority')) {
                priority = 'high';
            } else if (normalizedLabel.includes('medium priority')) {
                priority = 'medium';
            } else if (normalizedLabel.includes('low priority')) {
                priority = 'low';
            }
            filteredTasks = tasks.filter(task => task.priority === priority);
            log(`Filtered for priority '${priority}': ${filteredTasks.length} tasks.`);
        } else if (normalizedLabel.includes('(') && !normalizedLabel.includes('todo') && !normalizedLabel.includes('in progress') && !normalizedLabel.includes('completed') && !normalizedLabel.includes('blocked')) {
            // Handle category groups like "Frontend (2)"
            const category = categoryLabel.split(' (')[0];
            filteredTasks = tasks.filter(task => task.category === category);
            log(`Filtered for category '${category}': ${filteredTasks.length} tasks.`);
        }

        log(`Returning ${filteredTasks.length} task items for category '${categoryLabel}'.`);

        return filteredTasks.map(task => {
            // Check if this task is actually a subtask by looking for a parent task that contains it
            let parentTaskId: string | undefined;
            let isSubtask = false;
            
            // Search for a parent task that contains this task as a subtask
            const parentTask = tasks.find(mainTask => 
                mainTask.subtasks?.some(st => st.id.toString() === task.id.toString())
            );
            
            if (parentTask) {
                isSubtask = true;
                parentTaskId = parentTask.id.toString();
            }
            
            // Set collapsible state based on whether task has subtasks
            let collapsibleState = vscode.TreeItemCollapsibleState.None;
            if (task.subtasks && task.subtasks.length > 0) {
                const itemKey = this.getItemKey('task', task.id, task.id);
                const isExpanded = this.isExpanded(itemKey);
                collapsibleState = isExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
            }
            
            // Calculate nesting level based on task ID (number of dots) - fallback for display
            const nestingLevel = task.id?.toString().split('.').length - 1;
            
            log(`Creating TaskItem for ${task.id}: ${task.title} (status: ${task.status}, collapsible: ${collapsibleState}, isSubtask: ${isSubtask}, parentTaskId: ${parentTaskId || 'none'})`);
            
            return new TaskItem(
                `${task.id}: ${task.title}`,
                collapsibleState,
                task,
                isSubtask ? 'subtask' : 'task',
                nestingLevel,
                parentTaskId, // Pass parent task ID if this is a subtask
                this.getTagContext() // Pass tag context for tag-aware display
            );
        });
    }

    private async getTasksByPriorityGroups(tasks: Task[]): Promise<TaskItem[]> {
        const priorities = ['critical', 'high', 'medium', 'low'];
        const items: TaskItem[] = [];

        for (const priority of priorities) {
            const priorityTasks = tasks.filter(task => task.priority === priority);
            if (priorityTasks.length > 0) {
                const priorityEmoji = this.getPriorityEmojiForProvider(priority);
                const itemKey = this.getItemKey('category', `${this.capitalizeFirst(priority)} Priority`);
                const isExpanded = this.isExpanded(itemKey);
                const priorityItem = new TaskItem(
                    `${priorityEmoji} ${this.capitalizeFirst(priority)} Priority (${priorityTasks.length})`,
                    isExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
                    undefined,
                    'category'
                );
                priorityItem.iconPath = this.getPriorityIcon(priority);
                
                // Add tasks as children (we'll need to handle this in getChildren)
                items.push(priorityItem);
            }
        }

        return items;
    }

    private async getTasksByCategoryGroups(tasks: Task[]): Promise<TaskItem[]> {
        const categoryMap = new Map<string, Task[]>();
        
        tasks.forEach(task => {
            if (task.category) {
                if (!categoryMap.has(task.category)) {
                    categoryMap.set(task.category, []);
                }
                categoryMap.get(task.category)!.push(task);
            }
        });

        const items: TaskItem[] = [];
        for (const [category, categoryTasks] of categoryMap.entries()) {
            const itemKey = this.getItemKey('category', category);
            const isExpanded = this.isExpanded(itemKey);
            const categoryItem = new TaskItem(
                `${category} (${categoryTasks.length})`,
                isExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
                undefined,
                'category'
            );
            categoryItem.iconPath = new vscode.ThemeIcon('tag');
            items.push(categoryItem);
        }

        return items;
    }

    private async getProgressItems(): Promise<TaskItem[]> {
        const items: TaskItem[] = [];
        
        if (this.taskMasterClient) {
            log('Getting progress items from client.');
            const progress = await this.taskMasterClient.getTaskProgress();
            
            // Add main tasks summary first
            const mainTasksHeader = new TaskItem(
                `📋 Main Tasks (${progress.mainTasks.total})`,
                vscode.TreeItemCollapsibleState.None
            );
            mainTasksHeader.iconPath = new vscode.ThemeIcon('list-unordered', new vscode.ThemeColor('charts.blue'));
            mainTasksHeader.description = 'Task IDs only';
            items.push(mainTasksHeader);

            const mainTasksData = [
                { label: 'Completed', count: progress.mainTasks.completed, icon: 'check', color: 'charts.green' },
                { label: 'In Progress', count: progress.mainTasks.inProgress, icon: 'loading~spin', color: 'charts.blue' },
                { label: 'Todo', count: progress.mainTasks.todo, icon: 'circle-outline', color: 'charts.yellow' },
                { label: 'Blocked', count: progress.mainTasks.blocked, icon: 'error', color: 'charts.red' }
            ];

            for (const item of mainTasksData) {
                if (item.count > 0) { // Only show non-zero counts
                    const progressItem = new TaskItem(
                        `  ├─ ${item.label}: ${item.count}`,
                        vscode.TreeItemCollapsibleState.None
                    );
                    progressItem.iconPath = new vscode.ThemeIcon(
                        item.icon, 
                        item.color ? new vscode.ThemeColor(item.color) : undefined
                    );
                    
                    if (progress.mainTasks.total > 0) {
                        const percentage = Math.round((item.count / progress.mainTasks.total) * 100);
                        progressItem.description = `${percentage}%`;
                    }
                    
                    items.push(progressItem);
                }
            }

            // Add separator
            const separator = new TaskItem(
                ``,
                vscode.TreeItemCollapsibleState.None
            );
            items.push(separator);

            // Add all items summary
            const allItemsHeader = new TaskItem(
                `📊 All Items (${progress.allItems.total})`,
                vscode.TreeItemCollapsibleState.None
            );
            allItemsHeader.iconPath = new vscode.ThemeIcon('graph', new vscode.ThemeColor('charts.purple'));
            allItemsHeader.description = 'Including subtasks';
            items.push(allItemsHeader);

            const allItemsData = [
                { label: 'Completed', count: progress.allItems.completed, icon: 'check', color: 'charts.green' },
                { label: 'In Progress', count: progress.allItems.inProgress, icon: 'loading~spin', color: 'charts.blue' },
                { label: 'Todo', count: progress.allItems.todo, icon: 'circle-outline', color: 'charts.yellow' },
                { label: 'Blocked', count: progress.allItems.blocked, icon: 'error', color: 'charts.red' }
            ];

            for (const item of allItemsData) {
                if (item.count > 0) { // Only show non-zero counts
                    const progressItem = new TaskItem(
                        `  ├─ ${item.label}: ${item.count}`,
                        vscode.TreeItemCollapsibleState.None
                    );
                    progressItem.iconPath = new vscode.ThemeIcon(
                        item.icon, 
                        item.color ? new vscode.ThemeColor(item.color) : undefined
                    );
                    
                    if (progress.allItems.total > 0) {
                        const percentage = Math.round((item.count / progress.allItems.total) * 100);
                        progressItem.description = `${percentage}%`;
                    }
                    
                    items.push(progressItem);
                }
            }
        }
        log(`Returning ${items.length} progress items.`);
        return items;
    }

    private groupTasksByStatus(tasks: Task[]): Record<string, Task[]> {
        log(`Grouping ${tasks.length} tasks by status.`);
        const groups: Record<string, Task[]> = {
            'todo': [],
            'in-progress': [],
            'completed': [],
            'blocked': [],
            'deferred': [],
            'cancelled': [],
            'review': []
        };

        // Only include main tasks in status grouping - subtasks will appear under their parents
        tasks.forEach(task => {
            // Normalize status to the standard group keys
            let normalizedStatus = task.status;
            if (task.status === 'pending') {
                normalizedStatus = 'todo';
            } else if (task.status === 'done') {
                normalizedStatus = 'completed';
            }

            const statusGroup = groups[normalizedStatus];
            if (statusGroup) {
                statusGroup.push(task);
            }
        });

        // Log the counts for debugging
        Object.keys(groups).forEach(status => {
            const statusGroup = groups[status];
            if (statusGroup && statusGroup.length > 0) {
                log(`Status group '${status}': ${statusGroup.length} items`);
            }
        });

        return groups;
    }

    private getStatusIcon(status: string): vscode.ThemeIcon {
        switch (status) {
            case 'completed':
                return new vscode.ThemeIcon('check-all', new vscode.ThemeColor('charts.green'));
            case 'in-progress':
                return new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.blue'));
            case 'blocked':
                return new vscode.ThemeIcon('stop-circle', new vscode.ThemeColor('charts.red'));
            case 'deferred':
                return new vscode.ThemeIcon('clock', new vscode.ThemeColor('charts.orange'));
            case 'cancelled':
                return new vscode.ThemeIcon('x', new vscode.ThemeColor('editorError.foreground'));
            case 'review':
                return new vscode.ThemeIcon('eye', new vscode.ThemeColor('charts.purple'));
            case 'todo':
            default:
                return new vscode.ThemeIcon('list-unordered', new vscode.ThemeColor('charts.yellow'));
        }
    }

    private getPriorityIcon(priority: string): vscode.ThemeIcon {
        switch (priority) {
            case 'critical':
                return new vscode.ThemeIcon('alert', new vscode.ThemeColor('charts.red'));
            case 'high':
                return new vscode.ThemeIcon('triangle-up', new vscode.ThemeColor('charts.orange'));
            case 'medium':
                return new vscode.ThemeIcon('dash', new vscode.ThemeColor('charts.blue'));
            case 'low':
            default:
                return new vscode.ThemeIcon('triangle-down', new vscode.ThemeColor('charts.green'));
        }
    }

    private capitalizeFirst(str: string): string {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    private generateProgressBar(percentage: number): string {
        const barLength = 10;
        const filledLength = Math.round((percentage / 100) * barLength);
        const filled = '█'.repeat(filledLength);
        const empty = '░'.repeat(barLength - filledLength);
        return `[${filled}${empty}]`;
    }

    private getStatusEmojiForProvider(status: string): string {
        switch (status) {
            case 'completed':
            case 'done':
                return '✅';
            case 'in-progress':
                return '🔄';
            case 'blocked':
                return '❌';
            case 'deferred':
                return '⏰';
            case 'cancelled':
                return '❌';
            case 'review':
                return '👁️';
            case 'todo':
            case 'pending':
            default:
                return '⭕';
        }
    }

    private getPriorityEmojiForProvider(priority: string): string {
        switch (priority.toLowerCase()) {
            case 'high':
            case 'critical':
                return '🔴';
            case 'medium':
                return '🟡';
            case 'low':
                return '🟢';
            default:
                return '⚪';
        }
    }

    private getPriorityEmoji(priority: string): string {
        switch (priority.toLowerCase()) {
            case 'high':
            case 'critical':
                return '🔴';
            case 'medium':
                return '🟡';
            case 'low':
                return '🟢';
            default:
                return '⚪';
        }
    }

    private getDropdownIndicator(isExpanded: boolean = false): string {
        return isExpanded ? '▼' : '▶';
    }

    private async getNextRecommendedTask(tasks: Task[]): Promise<Task | null> {
        // Collect all available tasks (main tasks and subtasks)
        const allAvailableItems: Task[] = [];
        log('Determining next recommended task.');
        
        // Add main tasks that are pending/todo
        tasks.filter(task => task.status === 'todo' || task.status === 'pending')
             .forEach(task => allAvailableItems.push(task));
        
        // Add subtasks that are pending/todo
        tasks.forEach(task => {
            if (task.subtasks) {
                task.subtasks
                    .filter(subtask => subtask.status === 'todo' || subtask.status === 'pending')
                    .forEach(subtask => allAvailableItems.push(subtask));
            }
        });

        if (allAvailableItems.length === 0) {
            log('No available items to recommend.');
            return null;
        }
        log(`${allAvailableItems.length} available items found.`);

        // Find items with no dependencies or all dependencies completed
        const readyItems = allAvailableItems.filter(item => {
            if (!item.dependencies || item.dependencies.length === 0) {
                return true;
            }
            
            // Check if all dependencies are completed
            return item.dependencies.every(depId => {
                // Look for dependency in main tasks
                const depTask = tasks.find(t => t.id.toString() === depId.toString());
                if (depTask && (depTask.status === 'completed' || depTask.status === 'done')) {
                    return true;
                }
                
                // Look for dependency in subtasks
                for (const task of tasks) {
                    if (task.subtasks) {
                        const depSubtask = task.subtasks.find(st => st.id.toString() === depId.toString());
                        if (depSubtask && (depSubtask.status === 'completed' || depSubtask.status === 'done')) {
                            return true;
                        }
                    }
                }
                
                return false;
            });
        });

        if (readyItems.length === 0) {
            log('No items with met dependencies. Recommending first available item.');
            return allAvailableItems[0] || null; // Return first available if none are ready
        }
        log(`${readyItems.length} ready items found.`);

        // Sort by priority and ID, with preference for subtasks of in-progress tasks
        const priorityOrder = { 'critical': 4, 'high': 3, 'medium': 2, 'low': 1 };
        readyItems.sort((a, b) => {
            // Check if either is a subtask of an in-progress task
            // Ensure IDs are strings before using .includes()
            const aIdStr = a.id?.toString() || '';
            const bIdStr = b.id?.toString() || '';
            const aIsSubtaskOfInProgress = aIdStr.includes('.') && 
                tasks.some(task => task.status === 'in-progress' && 
                    task.subtasks?.some(st => st.id === a.id));
            const bIsSubtaskOfInProgress = bIdStr.includes('.') && 
                tasks.some(task => task.status === 'in-progress' && 
                    task.subtasks?.some(st => st.id === b.id));
            
            // Prioritize subtasks of in-progress tasks
            if (aIsSubtaskOfInProgress && !bIsSubtaskOfInProgress) {
                return -1;
            }
            if (!aIsSubtaskOfInProgress && bIsSubtaskOfInProgress) {
                return 1;
            }
            
            // Then sort by priority (subtasks inherit parent's priority)
            let aPriority = priorityOrder[a.priority as keyof typeof priorityOrder] || 2;
            let bPriority = priorityOrder[b.priority as keyof typeof priorityOrder] || 2;
            
            // For subtasks, use parent's priority if subtask doesn't have one
            if (aIdStr.includes('.') && !a.priority) {
                const parentTask = tasks.find(task => 
                    task.subtasks?.some(st => st.id === a.id)
                );
                if (parentTask?.priority) {
                    aPriority = priorityOrder[parentTask.priority as keyof typeof priorityOrder] || 2;
                }
            }
            
            if (bIdStr.includes('.') && !b.priority) {
                const parentTask = tasks.find(task => 
                    task.subtasks?.some(st => st.id === b.id)
                );
                if (parentTask?.priority) {
                    bPriority = priorityOrder[parentTask.priority as keyof typeof priorityOrder] || 2;
                }
            }
            
            if (aPriority !== bPriority) {
                return bPriority - aPriority; // Higher priority first
            }
            
            // If same priority, sort by ID (assuming numeric)
            const aId = parseFloat(a.id.toString());
            const bId = parseFloat(b.id.toString());
            return aId - bId;
        });

        const recommendedTask = readyItems[0];
        if (recommendedTask) {
            log(`Recommended task is: ${recommendedTask.id}`);
            return recommendedTask;
        }
        return null;
    }
} 