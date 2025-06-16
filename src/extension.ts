import * as vscode from 'vscode';
import { TaskProvider } from './taskProvider';
import { TaskMasterClient } from './taskMasterClient';
import { TagStatusBarItem } from './statusBar';
import * as path from 'path';
import * as fs from 'fs';
import { initializeLogger, disposeLogger, log } from './logger';
import { 
    Task, 
    TaskStatus, 
    TaskPriority, 
    TaskFormData, 
    SubtaskFormData, 
    TaskUpdateData, 
    CommandInfo, 
    UserInteractionDetails, 
    CommandResult, 
    SubtaskStats, 
    ExpandItemResult 
} from './types';
import { 
    getTagContext, 
    getTagAwarePlaceholder, 
    logTagOperation, 
    formatTagSuccessMessage 
} from './tagUtils';

let taskProvider: TaskProvider;
let taskMasterClient: TaskMasterClient;
let tagStatusBar: TagStatusBarItem;

// Enhanced logging utilities
function logUserInteraction(action: string, details?: UserInteractionDetails | null, context?: string) {
    const timestamp = new Date().toISOString();
    const contextInfo = context ? ` [Context: ${context}]` : '';
    const detailsInfo = details ? ` [Details: ${JSON.stringify(details)}]` : '';
    log(`🔧 USER INTERACTION [${timestamp}] ${action}${contextInfo}${detailsInfo}`);
}

function logCommandStart(command: string, details?: UserInteractionDetails): CommandInfo {
    const timestamp = new Date().toISOString();
    const detailsInfo = details ? ` [${JSON.stringify(details)}]` : '';
    log(`▶️  COMMAND START [${timestamp}] ${command}${detailsInfo}`);
    return { command, startTime: Date.now(), timestamp };
}

function logCommandEnd(commandInfo: CommandInfo, success: boolean = true, error?: Error, result?: CommandResult) {
    const duration = Date.now() - commandInfo.startTime;
    const status = success ? '✅ SUCCESS' : '❌ FAILED';
    const errorInfo = error ? ` [Error: ${error.message || String(error)}]` : '';
    const resultInfo = result ? ` [Result: ${JSON.stringify(result)}]` : '';
    log(`⏹️  COMMAND END [${duration}ms] ${commandInfo.command} - ${status}${errorInfo}${resultInfo}`);
}

export function activate(context: vscode.ExtensionContext) {
    initializeLogger();
    log('🚀 Claude Task Master extension is being activated');
    log('📁 Workspace folders: ' + (vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath).join(', ') || 'none'));

    // Check if taskmaster directory exists
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        log('No workspace folder found, deactivating.');
        return;
    }

    const taskmasterPath = path.join(workspaceFolder.uri.fsPath, '.taskmaster');
    const hasTaskmaster = fs.existsSync(taskmasterPath);
    
    // Set context for conditional view visibility
    vscode.commands.executeCommand('setContext', 'claudeTaskMaster.hasTaskmaster', hasTaskmaster);

    if (!hasTaskmaster) {
        log('❌ No .taskmaster directory found in workspace at: ' + taskmasterPath);
        // Show a message directing users to task-master-ai
        vscode.window.showInformationMessage(
            'This extension requires a task-master-ai project. Initialize task-master-ai to get started.',
            'Learn About Task Master AI',
            'Open Terminal'
        ).then(selection => {
            if (selection === 'Learn About Task Master AI') {
                vscode.env.openExternal(vscode.Uri.parse('https://github.com/eyaltoledano/claude-task-master'));
            } else if (selection === 'Open Terminal') {
                vscode.commands.executeCommand('workbench.action.terminal.new');
                vscode.window.showInformationMessage('Run "npm install -g task-master-ai" then "task-master init" or use Claude AI chat with task-master-ai MCP to initialize.');
            }
        });
        return;
    }
    log('✅ .taskmaster directory found.');

    // Initialize task master client and provider
    taskMasterClient = new TaskMasterClient(taskmasterPath);
    taskProvider = new TaskProvider(taskMasterClient);
    log('TaskMasterClient and TaskProvider initialized.');

    // Initialize status bar for tag management
    tagStatusBar = new TagStatusBarItem(context, taskMasterClient);
    log('TagStatusBarItem initialized.');

    // Register tree data provider
    const treeView = vscode.window.createTreeView('claudeTaskMasterMainView', {
        treeDataProvider: taskProvider,
        showCollapseAll: true
    });
    log('Tree view created and registered.');

    // Register commands
    const commands = [
        vscode.commands.registerCommand('claudeTaskMaster.refresh', () => {
            const cmdInfo = logCommandStart('claudeTaskMaster.refresh');
            logUserInteraction('Refresh button clicked', null, 'tree-view');
            try {
            taskProvider.refresh();
                logCommandEnd(cmdInfo, true, undefined, { success: true, message: 'Tree view refreshed' });
            } catch (error) {
                logCommandEnd(cmdInfo, false, error instanceof Error ? error : new Error(String(error)));
            }
        }),

        vscode.commands.registerCommand('claudeTaskMaster.expandAll', async () => {
            const cmdInfo = logCommandStart('claudeTaskMaster.expandAll');
            logUserInteraction('Expand All button clicked', null, 'tree-view');
            try {
            await expandAllTasks(treeView);
                logCommandEnd(cmdInfo, true, undefined, { success: true, message: 'All tree items expanded' });
            } catch (error) {
                logCommandEnd(cmdInfo, false, error instanceof Error ? error : new Error(String(error)));
            }
        }),

        vscode.commands.registerCommand('claudeTaskMaster.showTask', async (taskItem, parentTaskId?) => {
            const cmdInfo = logCommandStart('claudeTaskMaster.showTask');
            if (taskItem && taskItem.task) {
                log(`🔍 TREE CLICK DEBUG: taskItem.task.id="${taskItem.task.id}" (type: ${typeof taskItem.task.id}), title="${taskItem.task.title}"`);
                log(`🔍 TREE CLICK DEBUG: parentTaskId="${parentTaskId || 'none'}", taskItem.type="${taskItem.type}"`);
                log(`🔍 TREE CLICK DEBUG: Full task object: ${JSON.stringify(taskItem.task, null, 2)}`);
                logUserInteraction('Task clicked for details', { 
                    taskId: taskItem.task.id, 
                    parentTaskId: parentTaskId,
                    taskTitle: taskItem.task.title,
                    taskStatus: taskItem.task.status,
                    source: taskItem.type || 'unknown'
                }, 'tree-view');
                try {
                    await showTaskDetails(taskItem.task, context, parentTaskId);
                    logCommandEnd(cmdInfo, true, undefined, { success: true, taskId: taskItem.task.id, parentTaskId: parentTaskId, action: 'details-opened' });
                } catch (error) {
                    logCommandEnd(cmdInfo, false, error instanceof Error ? error : new Error(String(error)));
                }
            } else {
                logUserInteraction('Invalid task click attempt', null, 'tree-view');
                logCommandEnd(cmdInfo, false, new Error('No valid task item provided'));
            }
        }),

        vscode.commands.registerCommand('claudeTaskMaster.setTaskStatus', async (taskItem) => {
            const cmdInfo = logCommandStart('claudeTaskMaster.setTaskStatus');
            if (taskItem && taskItem.task) {
                logUserInteraction('Task status change initiated', { 
                    taskId: taskItem.task.id,
                    currentStatus: taskItem.task.status
                }, 'context-menu');
                try {
                await setTaskStatusInteractive(taskItem.task);
                    logCommandEnd(cmdInfo, true, undefined, { success: true, taskId: taskItem.task.id, action: 'status-dialog-opened' });
                } catch (error) {
                    logCommandEnd(cmdInfo, false, error instanceof Error ? error : new Error(String(error)));
                }
            } else {
                logUserInteraction('Invalid task status change attempt', null, 'context-menu');
                logCommandEnd(cmdInfo, false, new Error('No valid task item provided'));
            }
        }),

        vscode.commands.registerCommand('claudeTaskMaster.expandTask', async (taskItem) => {
            if (taskItem && taskItem.task) {
                log(`Executing command: claudeTaskMaster.expandTask for task ID ${taskItem.task.id}`);
                await expandTask(taskItem.task);
            } else {
                log('claudeTaskMaster.expandTask command called without a valid task item.');
            }
        }),

        vscode.commands.registerCommand('claudeTaskMaster.nextTask', async () => {
            log('Executing command: claudeTaskMaster.nextTask');
            await showNextTask(context);
        }),

        vscode.commands.registerCommand('claudeTaskMaster.openPRD', async () => {
            log('Executing command: claudeTaskMaster.openPRD');
            await openPRD();
        }),

        vscode.commands.registerCommand('claudeTaskMaster.startWorking', async (taskItem) => {
            if (taskItem && taskItem.task) {
                log(`Executing command: claudeTaskMaster.startWorking for task ID ${taskItem.task.id}, parentTaskId: ${taskItem.parentTaskId || 'none'}`);
                await startWorkingOnTask(taskItem.task, context, taskItem.parentTaskId);
            } else {
                log('claudeTaskMaster.startWorking command called without a valid task item.');
            }
        }),

        vscode.commands.registerCommand('claudeTaskMaster.addTask', async (categoryItem) => {
            log(`Executing command: claudeTaskMaster.addTask for category: ${categoryItem?.label || 'none'}`);
            await addNewTask(categoryItem);
        }),

        // Tag management commands
        vscode.commands.registerCommand('claudeTaskMaster.switchTag', async () => {
            const cmdInfo = logCommandStart('claudeTaskMaster.switchTag');
            logUserInteraction('Switch tag initiated', null, 'tag-management');
            try {
                await switchTagHandler();
                logCommandEnd(cmdInfo, true, undefined, { success: true, action: 'tag-switch-dialog-opened' });
            } catch (error) {
                logCommandEnd(cmdInfo, false, error instanceof Error ? error : new Error(String(error)));
            }
        }),

        vscode.commands.registerCommand('claudeTaskMaster.createTag', async () => {
            const cmdInfo = logCommandStart('claudeTaskMaster.createTag');
            logUserInteraction('Create tag initiated', null, 'tag-management');
            try {
                await createTagHandler();
                logCommandEnd(cmdInfo, true, undefined, { success: true, action: 'tag-create-dialog-opened' });
            } catch (error) {
                logCommandEnd(cmdInfo, false, error instanceof Error ? error : new Error(String(error)));
            }
        }),

        vscode.commands.registerCommand('claudeTaskMaster.deleteTag', async () => {
            const cmdInfo = logCommandStart('claudeTaskMaster.deleteTag');
            logUserInteraction('Delete tag initiated', null, 'tag-management');
            try {
                await deleteTagHandler();
                logCommandEnd(cmdInfo, true, undefined, { success: true, action: 'tag-delete-dialog-opened' });
            } catch (error) {
                logCommandEnd(cmdInfo, false, error instanceof Error ? error : new Error(String(error)));
            }
        }),

        vscode.commands.registerCommand('claudeTaskMaster.listTags', async () => {
            const cmdInfo = logCommandStart('claudeTaskMaster.listTags');
            logUserInteraction('List tags initiated', null, 'tag-management');
            try {
                await listTagsHandler();
                logCommandEnd(cmdInfo, true, undefined, { success: true, action: 'tag-list-displayed' });
            } catch (error) {
                logCommandEnd(cmdInfo, false, error instanceof Error ? error : new Error(String(error)));
            }
        }),

        vscode.commands.registerCommand('claudeTaskMaster.addSubtask', async (taskItem) => {
            if (taskItem && taskItem.task) {
                log(`Executing command: claudeTaskMaster.addSubtask for parent task ID ${taskItem.task.id}`);
                await addNewSubtask(taskItem.task);
            } else {
                log('claudeTaskMaster.addSubtask command called without a valid task item.');
            }
        }),

        vscode.commands.registerCommand('claudeTaskMaster.editTask', async (taskItem) => {
            if (taskItem && taskItem.task) {
                log(`Executing command: claudeTaskMaster.editTask for task ID ${taskItem.task.id}`);
                await editTask(taskItem.task);
            } else {
                log('claudeTaskMaster.editTask command called without a valid task item.');
            }
        }),

        vscode.commands.registerCommand('claudeTaskMaster.editTaskTitle', async (taskItem) => {
            if (taskItem && taskItem.task) {
                log(`Executing command: claudeTaskMaster.editTaskTitle for task ID ${taskItem.task.id}`);
                await editTaskTitle(taskItem.task);
            } else {
                log('claudeTaskMaster.editTaskTitle command called without a valid task item.');
            }
        }),

        vscode.commands.registerCommand('claudeTaskMaster.deleteTask', async (taskItem) => {
            if (taskItem && taskItem.task) {
                log(`Executing command: claudeTaskMaster.deleteTask for task ID ${taskItem.task.id}`);
                await deleteTask(taskItem.task);
            } else {
                log('claudeTaskMaster.deleteTask command called without a valid task item.');
            }
        }),

        // Quick status change commands
        vscode.commands.registerCommand('claudeTaskMaster.markCompleted', async (taskItem) => {
            if (taskItem && taskItem.task) {
                log(`Executing command: claudeTaskMaster.markCompleted for task ID ${taskItem.task.id}`);
                await setTaskStatusWithContext(taskItem.task, 'completed', taskItem.parentTaskId);
            } else {
                log('claudeTaskMaster.markCompleted command called without a valid task item.');
            }
        }),

        vscode.commands.registerCommand('claudeTaskMaster.markInProgress', async (taskItem) => {
            if (taskItem && taskItem.task) {
                log(`Executing command: claudeTaskMaster.markInProgress for task ID ${taskItem.task.id}`);
                await setTaskStatusWithContext(taskItem.task, 'in-progress', taskItem.parentTaskId);
            } else {
                log('claudeTaskMaster.markInProgress command called without a valid task item.');
            }
        }),

        vscode.commands.registerCommand('claudeTaskMaster.markTodo', async (taskItem) => {
            if (taskItem && taskItem.task) {
                log(`Executing command: claudeTaskMaster.markTodo for task ID ${taskItem.task.id}`);
                await setTaskStatusWithContext(taskItem.task, 'todo', taskItem.parentTaskId);
            } else {
                log('claudeTaskMaster.markTodo command called without a valid task item.');
            }
        }),

        vscode.commands.registerCommand('claudeTaskMaster.markBlocked', async (taskItem) => {
            if (taskItem && taskItem.task) {
                log(`Executing command: claudeTaskMaster.markBlocked for task ID ${taskItem.task.id}`);
                await setTaskStatusWithContext(taskItem.task, 'blocked', taskItem.parentTaskId);
            } else {
                log('claudeTaskMaster.markBlocked command called without a valid task item.');
            }
        }),

        // Property management commands
        vscode.commands.registerCommand('claudeTaskMaster.changePriority', async (taskItem) => {
            if (taskItem && taskItem.task) {
                log(`Executing command: claudeTaskMaster.changePriority for task ID ${taskItem.task.id}`);
                await changePriority(taskItem.task);
            } else {
                log('claudeTaskMaster.changePriority command called without a valid task item.');
            }
        }),

        vscode.commands.registerCommand('claudeTaskMaster.setDependencies', async (taskItem) => {
            if (taskItem && taskItem.task) {
                log(`Executing command: claudeTaskMaster.setDependencies for task ID ${taskItem.task.id}`);
                await setDependencies(taskItem.task);
            } else {
                log('claudeTaskMaster.setDependencies command called without a valid task item.');
            }
        }),

        vscode.commands.registerCommand('claudeTaskMaster.copyTaskDetails', async (taskItem) => {
            if (taskItem && taskItem.task) {
                log(`Executing command: claudeTaskMaster.copyTaskDetails for task ID ${taskItem.task.id}`);
                await copyTaskDetails(taskItem.task);
            } else {
                log('claudeTaskMaster.copyTaskDetails command called without a valid task item.');
            }
        }),

        // Search and Filter Commands
        vscode.commands.registerCommand('claudeTaskMaster.search', async () => {
            log('Executing command: claudeTaskMaster.search');
            await showSearchDialog();
        }),

        vscode.commands.registerCommand('claudeTaskMaster.filterByStatus', async () => {
            log('Executing command: claudeTaskMaster.filterByStatus');
            await showStatusFilterDialog();
        })

    ];

    commands.forEach(cmd => context.subscriptions.push(cmd));
    log(`Registered ${commands.length} commands.`);

    // Watch for file changes if auto-refresh is enabled
    const config = vscode.workspace.getConfiguration('claudeTaskMaster');
    if (config.get('autoRefresh', true)) {
        log('Auto-refresh is enabled. Creating file watcher.');
        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(workspaceFolder, '.taskmaster/**/*')
        );
        
        watcher.onDidChange(() => {
            log('File change detected in .taskmaster directory, refreshing view.');
            taskProvider.refresh();
        });
        watcher.onDidCreate(() => {
            log('File creation detected in .taskmaster directory, refreshing view.');
            taskProvider.refresh();
        });
        watcher.onDidDelete(() => {
            log('File deletion detected in .taskmaster directory, refreshing view.');
            taskProvider.refresh();
        });
        
        context.subscriptions.push(watcher);
    } else {
        log('Auto-refresh is disabled.');
    }

    log('✅ Claude Task Master extension activated successfully');
}

export function extractParentTaskId(taskId: string): string | undefined {
    const idStr = taskId.toString();
    if (idStr.includes('.')) {
        // This is a subtask - extract parent ID (everything before the first dot)
        return idStr.split('.')[0];
    }
    return undefined; // This is a main task
}

async function getTaskDetailsImproved(taskId: string, parentTaskId?: string): Promise<Task | null> {
    try {
        log(`🔍 IMPROVED LOOKUP: Looking for taskId="${taskId}", parentTaskId="${parentTaskId || 'none'}"`);
        
        // Parse the taskId to determine if it's a main task or subtask
        let mainTaskId: string;
        let subtaskId: string | undefined;
        
        if (parentTaskId) {
            // If we have a parentTaskId, that's the main task and taskId is the subtask
            mainTaskId = parentTaskId;
            subtaskId = taskId;
            log(`🔍 PARSED WITH PARENT: mainTaskId="${mainTaskId}", subtaskId="${subtaskId}"`);
        } else if (taskId.includes('.')) {
            // Handle dot notation like "1.2" or "1.2.3"
            const parts = taskId.split('.');
            mainTaskId = parts[0] || '';
            subtaskId = parts.slice(1).join('.');
            log(`🔍 PARSED DOT NOTATION: mainTaskId="${mainTaskId}", subtaskId="${subtaskId}"`);
        } else {
            // Simple main task ID
            mainTaskId = taskId;
            subtaskId = undefined;
            log(`🔍 PARSED MAIN TASK: mainTaskId="${mainTaskId}"`);
        }
        
        // Use the updated getTaskDetails method with proper parameters
        const result = await taskMasterClient.getTaskDetails(mainTaskId, subtaskId);
        log(`🔍 IMPROVED LOOKUP: Result: ${result ? `found task "${result.title}" (ID: ${result.id})` : 'not found'}`);
        return result;
        
    } catch (error) {
        log(`🔍 IMPROVED LOOKUP: Error in improved lookup: ${error}`);
        return null;
    }
}

async function showTaskDetails(task: Task, context: vscode.ExtensionContext, parentTaskId?: string) {
    try {
        log(`Showing task details for ID: ${task.id} (type: ${typeof task.id}), Title: "${task.title}", ParentTaskId: ${parentTaskId || 'none'}`);
        
        // Add detailed debug logging
        log(`Task object details: ${JSON.stringify({
            id: task.id,
            idType: typeof task.id,
            title: task.title,
            status: task.status,
            isSubtask: task.id && task.id.toString().includes('.'),
            parentTaskId: parentTaskId,
            rawTask: task
        }, null, 2)}`);
        
        // Use improved lookup method that handles both main tasks and subtasks properly
        const details = await getTaskDetailsImproved(task.id, parentTaskId);
        
        if (details) {
            log(`Retrieved task details: ID=${details.id}, Title="${details.title}", IsSubtask=${details.id && details.id.toString().includes('.')}`);
        } else {
            log(`No task details found for ID: ${task.id}`);
        }
        
        // Check if this is a subtask and create appropriate title
        const isSubtask = !!parentTaskId || (task.id && task.id.toString().includes('.'));
        let panelTitle;
        
        if (isSubtask) {
            const idParts = task.id.toString().split('.');
            const parentId = idParts[0];
            const subtaskNumber = idParts.slice(1).join('.');
            panelTitle = `Task ${parentId} → Subtask ${subtaskNumber}: ${task.title}`;
        } else {
            panelTitle = `Task ${task.id}: ${task.title}`;
        }

        const panel = vscode.window.createWebviewPanel(
            'taskDetails',
            panelTitle,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        panel.webview.html = generateTaskDetailsHtml(details || task, parentTaskId);

        // Handle messages from the webview
        panel.webview.onDidReceiveMessage(
            async (message) => {
                log(`Received message from webview: ${message.command}`);
                switch (message.command) {
                    case 'updateSubtaskStatus':
                        try {
                            log(`Updating subtask status for subtask ID ${message.subtaskId} in parent task ${task.id}`);
                            
                            // Determine the parent task ID for the subtask update
                            const actualParentTaskId = parentTaskId || task.id.toString();
                            
                            // Use the new setSubtaskStatus method that requires both parent and subtask IDs
                            await taskMasterClient.setSubtaskStatus(actualParentTaskId, message.subtaskId, message.status);
                            taskProvider.refresh();
                            vscode.window.showInformationMessage(
                                `Subtask ${message.subtaskId} in Task ${actualParentTaskId} marked as ${message.status}`
                            );
                            // Refresh the webview with updated data
                            log(`Refreshing webview for task ${task.id} after subtask update.`);
                            const updatedDetails = await getTaskDetailsImproved(task.id, parentTaskId);
                            if (updatedDetails) {
                                panel.webview.html = generateTaskDetailsHtml(updatedDetails, parentTaskId);
                            }
                        } catch (error) {
                            const errorMessage = error instanceof Error ? error.message : String(error);
                            log(`Error updating subtask: ${errorMessage}`);
                            vscode.window.showErrorMessage(`Failed to update subtask: ${errorMessage}`);
                        }
                        break;

                    case 'updateTaskStatus':
                        log(`Updating task status interactively for task ${task.id}`);
                        await setTaskStatusInteractive(task);
                        // Refresh the webview with updated data
                        log(`Refreshing webview for task ${task.id} after task status update.`);
                        const updatedTaskDetails = await getTaskDetailsImproved(task.id, parentTaskId);
                        if (updatedTaskDetails) {
                            panel.webview.html = generateTaskDetailsHtml(updatedTaskDetails, parentTaskId);
                        }
                        break;

                    case 'expandTask':
                        log(`Expanding task ${task.id} from webview.`);
                        await expandTask(task);
                        break;

                    case 'addSubtask':
                        // Only allow adding subtasks to main tasks, not to subtasks
                        if (isSubtask) {
                            vscode.window.showWarningMessage(
                                `Cannot add subtasks to subtask ${task.id}. Please add subtasks to the parent task instead.`
                            );
                        } else {
                                // Try to add subtask with CLI fallback
    try {
        await addNewSubtaskWithFallback(task);
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to add subtask: ${error}`);
    }
                        }
                        break;

                    case 'startWorking':
                        await setTaskStatusWithContext(task, 'in-progress', parentTaskId);
                        // Refresh the webview with updated data
                        const workingTaskDetails = await getTaskDetailsImproved(task.id, parentTaskId);
                        if (workingTaskDetails) {
                            panel.webview.html = generateTaskDetailsHtml(workingTaskDetails, parentTaskId);
                        }
                        
                        if (isSubtask) {
                            const idParts = task.id.toString().split('.');
                            const parentId = idParts[0];
                            const subtaskNumber = idParts.slice(1).join('.');
                            vscode.window.showInformationMessage(
                                `🎯 Started working on Task ${parentId} → Subtask ${subtaskNumber}: ${task.title}`
                            );
                        } else {
                            vscode.window.showInformationMessage(
                                `🎯 Started working on Task ${task.id}: ${task.title}`
                            );
                        }
                        break;
                }
            },
            undefined,
            context.subscriptions
        );
    } catch (error) {
        log(`Error in showTaskDetails: ${error}`);
        vscode.window.showErrorMessage(`Failed to load task details: ${error}`);
    }
}

async function expandTask(task: Task) {
    try {
        try {
            await expandTaskWithFallback(task);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to expand task: ${error}`);
        }
        // For now, we'll show an info message
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to expand task: ${error}`);
    }
}

async function showNextTask(context: vscode.ExtensionContext) {
    try {
        const tagContext = getTagContext(taskMasterClient);
        logTagOperation('Show Next Task', tagContext);
        
        const nextTask = await taskMasterClient.getNextTask();
        if (nextTask) {
            // Determine if this is a subtask and extract parent ID if needed
            const parentTaskId = extractParentTaskId(nextTask.id);
            log(`showNextTask: nextTask.id="${nextTask.id}", extracted parentTaskId="${parentTaskId || 'none'}"`);
            await showTaskDetails(nextTask, context, parentTaskId);
        } else {
            const message = formatTagSuccessMessage('No next task available', tagContext);
            vscode.window.showInformationMessage(message);
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to get next task: ${error}`);
    }
}

async function openPRD() {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        return;
    }

    const prdPaths = [
        '.taskmaster/docs/prd.txt',
        '.taskmaster/docs/prd.md',
        'scripts/prd.txt',
        'prd.txt'
    ];

    for (const prdPath of prdPaths) {
        const fullPath = path.join(workspaceFolder.uri.fsPath, prdPath);
        if (fs.existsSync(fullPath)) {
            const document = await vscode.workspace.openTextDocument(fullPath);
            await vscode.window.showTextDocument(document);
            return;
        }
    }

    vscode.window.showWarningMessage('No PRD file found. Create one at .taskmaster/docs/prd.txt');
}

async function startWorkingOnTask(task: Task, context: vscode.ExtensionContext, parentTaskId?: string) {
    try {
        const tagContext = getTagContext(taskMasterClient);
        logTagOperation('Start Working on Task', tagContext, { taskId: task.id, taskTitle: task.title });
        
        // Show task details first using improved lookup
        await showTaskDetails(task, context, parentTaskId);
        
        // Set task status to in-progress with tag-aware confirmation
        const confirmMessage = tagContext.isTaggedFormat
            ? `[Tag: ${tagContext.currentTag}] Start working on "${task.title}"? This will set the task status to "in-progress".`
            : `Start working on "${task.title}"? This will set the task status to "in-progress".`;
            
        const confirmed = await vscode.window.showInformationMessage(
            confirmMessage,
            'Start Working',
            'Cancel'
        );
        
        if (confirmed === 'Start Working') {
            await setTaskStatusWithContext(task, 'in-progress', parentTaskId);
            
            const successMessage = formatTagSuccessMessage(
                `🎯 Started working on Task ${task.id}: ${task.title}`,
                tagContext
            );
            vscode.window.showInformationMessage(successMessage);
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to start working on task: ${error}`);
    }
}

function generateTaskDetailsHtml(task: Task, parentTaskId?: string): string {
    // Determine if it's a subtask based on parentTaskId presence
    const isSubtask = !!parentTaskId;
    
    // Get tag context for display
    const tagContext = taskMasterClient.getTagContext();
    
    // Parse parent and subtask information for better display
    let taskDisplayInfo = {
        taskId: task.id,
        taskType: isSubtask ? 'Subtask' : 'Main Task',
        parentInfo: isSubtask ? `Part of Task ${parentTaskId}` : '',
        fullHierarchy: isSubtask ? `Task ${parentTaskId} → Subtask ${task.id}` : `Task ${task.id}`,
        tagInfo: tagContext.isTaggedFormat ? `Tag: ${tagContext.currentTag}` : ''
        };
    
    // Calculate subtask progress (only for main tasks)
    const subtaskStats: SubtaskStats = !isSubtask && task.subtasks ? {
        total: task.subtasks.length,
        completed: task.subtasks.filter((st: Task) => st.status === 'completed' || st.status === 'done').length,
        inProgress: task.subtasks.filter((st: Task) => st.status === 'in-progress').length,
        blocked: task.subtasks.filter((st: Task) => st.status === 'blocked').length
    } : { total: 0, completed: 0, inProgress: 0, blocked: 0 };

    const progressPercentage = subtaskStats.total > 0 ? 
        Math.round((subtaskStats.completed / subtaskStats.total) * 100) : 0;

    // Helper function to get status icon
    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'completed': 
            case 'done': return '✅';
            case 'in-progress': return '🔄';
            case 'blocked': return '❌';
            case 'todo': 
            case 'pending':
            default: return '⭕';
        }
    };

    // Helper function to get priority color and icon
    const getPriorityInfo = (priority: string) => {
        switch (priority?.toLowerCase()) {
            case 'critical': return { color: 'var(--vscode-errorForeground)', icon: '🔥', text: 'Critical' };
            case 'high': return { color: 'var(--vscode-testing-iconFailed)', icon: '⬆️', text: 'High' };
            case 'medium': return { color: 'var(--vscode-testing-iconQueued)', icon: '➡️', text: 'Medium' };
            case 'low': return { color: 'var(--vscode-testing-iconPassed)', icon: '⬇️', text: 'Low' };
            default: return { color: 'var(--vscode-foreground)', icon: '➡️', text: 'N/A' };
        }
    };

    const priorityInfo = getPriorityInfo(task.priority || 'medium');

    // Enhanced HTML with modern styling and interactive elements
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Task Details</title>
    <style>
        :root {
            /* Enhanced color palette with better contrast */
            --tm-bg-primary: var(--vscode-editor-background, #1e1e1e);
            --tm-bg-secondary: var(--vscode-sideBar-background, #252526);
            --tm-bg-tertiary: var(--vscode-input-background, #2d2d30);
            --tm-text-primary: var(--vscode-editor-foreground, #cccccc);
            --tm-text-secondary: var(--vscode-descriptionForeground, #999999);
            --tm-text-muted: #6a6a6a;
            --tm-border: var(--vscode-panel-border, #3c3c3c);
            --tm-border-hover: var(--vscode-focusBorder, #007acc);
            --tm-accent: var(--vscode-textLink-foreground, #4fc3f7);
            --tm-accent-hover: #29b6f6;
            
            /* Enhanced status colors with gradients */
            --tm-status-todo: linear-gradient(135deg, #ff9800, #f57c00);
            --tm-status-progress: linear-gradient(135deg, #2196f3, #1976d2);
            --tm-status-done: linear-gradient(135deg, #4caf50, #388e3c);
            --tm-status-blocked: linear-gradient(135deg, #f44336, #d32f2f);
            --tm-status-review: linear-gradient(135deg, #9c27b0, #7b1fa2);
            
            /* Priority gradients */
            --tm-priority-critical: linear-gradient(135deg, #ff1744, #d50000);
            --tm-priority-high: linear-gradient(135deg, #ff5722, #d84315);
            --tm-priority-medium: linear-gradient(135deg, #ff9800, #f57c00);
            --tm-priority-low: linear-gradient(135deg, #4caf50, #388e3c);
            
            /* Shadow definitions */
            --tm-shadow-sm: 0 2px 4px rgba(0, 0, 0, 0.1);
            --tm-shadow-md: 0 4px 12px rgba(0, 0, 0, 0.15);
            --tm-shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.2);
            --tm-shadow-hover: 0 8px 32px rgba(0, 0, 0, 0.25);
        }

        body {
            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif);
            color: var(--tm-text-primary);
            background: linear-gradient(135deg, var(--tm-bg-primary) 0%, color-mix(in srgb, var(--tm-bg-primary) 95%, var(--tm-accent) 5%) 100%);
            padding: 0;
            margin: 0;
            line-height: 1.6;
            overflow-x: hidden;
            font-size: 14px;
            min-height: 100vh;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 24px;
        }

        /* Animated background pattern */
        .container::before {
            content: '';
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: 
                radial-gradient(circle at 20% 80%, rgba(120, 119, 198, 0.03) 0%, transparent 50%),
                radial-gradient(circle at 80% 20%, rgba(255, 119, 198, 0.03) 0%, transparent 50%),
                radial-gradient(circle at 40% 40%, rgba(120, 200, 255, 0.03) 0%, transparent 50%);
            pointer-events: none;
            z-index: -1;
        }

        .task-header {
            background: linear-gradient(135deg, var(--tm-bg-secondary) 0%, color-mix(in srgb, var(--tm-bg-secondary) 95%, var(--tm-accent) 5%) 100%);
            border: 2px solid var(--tm-border);
            border-radius: 16px;
            padding: 32px;
            margin-bottom: 32px;
            box-shadow: var(--tm-shadow-lg);
            position: relative;
            overflow: hidden;
            transition: all 0.3s ease;
        }

        .task-header::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 4px;
            background: ${isSubtask ? 
                'linear-gradient(90deg, #9c27b0, #e91e63)' : 
                'linear-gradient(90deg, var(--tm-accent), #00bcd4)'};
            border-radius: 16px 16px 0 0;
        }

        .task-header:hover {
            box-shadow: var(--tm-shadow-hover);
            transform: translateY(-2px);
        }

        .task-hierarchy {
            color: var(--tm-text-secondary);
            font-size: 14px;
            margin-bottom: 12px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 1px;
            opacity: 0.8;
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
        }

        .tag-indicator {
            background: linear-gradient(135deg, var(--tm-accent), var(--tm-accent-hover));
            color: #ffffff;
            padding: 4px 8px;
            border-radius: 8px;
            font-size: 12px;
            font-weight: 700;
            text-transform: none;
            letter-spacing: 0;
            box-shadow: var(--tm-shadow-sm);
            opacity: 1;
        }

        .task-title {
            margin: 0 0 24px 0;
            font-size: clamp(24px, 4vw, 32px);
            font-weight: 800;
            color: var(--tm-text-primary);
            line-height: 1.2;
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 16px;
        }

        .task-id {
            color: #ffffff;
            font-weight: 700;
            background: var(--tm-accent);
            background: linear-gradient(135deg, var(--tm-accent), var(--tm-accent-hover));
            padding: 8px 16px;
            border-radius: 12px;
            font-size: 14px;
            display: inline-flex;
            align-items: center;
            box-shadow: var(--tm-shadow-sm);
            transition: all 0.2s ease;
        }

        .task-id:hover {
            transform: scale(1.05);
            box-shadow: var(--tm-shadow-md);
        }

        .task-type-badge {
            color: #ffffff;
            font-weight: 700;
            background: ${isSubtask ? 
                'linear-gradient(135deg, #9c27b0, #7b1fa2)' : 
                'linear-gradient(135deg, #4caf50, #388e3c)'};
            padding: 8px 16px;
            border-radius: 12px;
            font-size: 12px;
            display: inline-flex;
            align-items: center;
            text-transform: uppercase;
            letter-spacing: 1px;
            box-shadow: var(--tm-shadow-sm);
            transition: all 0.2s ease;
        }

        .task-type-badge:hover {
            transform: scale(1.05);
            box-shadow: var(--tm-shadow-md);
        }

        .parent-info {
            color: var(--tm-text-secondary);
            font-size: 14px;
            margin-top: 12px;
            font-style: italic;
            padding: 8px 16px;
            background: var(--tm-bg-tertiary);
            border-radius: 8px;
            border-left: 3px solid var(--tm-accent);
        }

        .task-meta {
            display: flex;
            flex-wrap: wrap;
            gap: 16px;
            align-items: center;
            margin-top: 24px;
        }

        .status-badge, .priority-badge {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 10px 20px;
            border-radius: 12px;
            font-size: 13px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            border: 2px solid transparent;
            box-shadow: var(--tm-shadow-sm);
            transition: all 0.3s ease;
            position: relative;
            overflow: hidden;
        }

        .status-badge::before, .priority-badge::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
            transition: left 0.5s;
        }

        .status-badge:hover::before, .priority-badge:hover::before {
            left: 100%;
        }

        .status-todo, .status-pending { 
            background: var(--tm-status-todo);
            color: #ffffff;
        }
        .status-in-progress { 
            background: var(--tm-status-progress);
            color: #ffffff;
        }
        .status-completed, .status-done { 
            background: var(--tm-status-done);
            color: #ffffff;
        }
        .status-blocked { 
            background: var(--tm-status-blocked);
            color: #ffffff;
        }
        .status-review {
            background: var(--tm-status-review);
            color: #ffffff;
        }

        .priority-badge {
            background: ${task.priority === 'critical' ? 'var(--tm-priority-critical)' : 
                             task.priority === 'high' ? 'var(--tm-priority-high)' :
                             task.priority === 'medium' ? 'var(--tm-priority-medium)' : 
                             'var(--tm-priority-low)'};
            color: #ffffff;
        }

        .content-section {
            background: var(--tm-bg-secondary);
            border: 2px solid var(--tm-border);
            border-radius: 16px;
            padding: 32px;
            margin-bottom: 32px;
            box-shadow: var(--tm-shadow-md);
            transition: all 0.3s ease;
            position: relative;
        }

        .content-section:hover {
            border-color: var(--tm-border-hover);
            box-shadow: var(--tm-shadow-lg);
            transform: translateY(-1px);
        }

        .section-title {
            font-size: 22px;
            font-weight: 700;
            margin: 0 0 24px 0;
            color: var(--tm-text-primary);
            display: flex;
            align-items: center;
            gap: 12px;
            border-bottom: 2px solid var(--tm-border);
            padding-bottom: 16px;
            position: relative;
        }

        .section-title::after {
            content: '';
            position: absolute;
            bottom: -2px;
            left: 0;
            width: 60px;
            height: 2px;
            background: var(--tm-accent);
            border-radius: 1px;
        }

        .task-description {
            white-space: pre-wrap;
            font-size: 16px;
            line-height: 1.8;
            color: var(--tm-text-primary);
            background: var(--tm-bg-primary);
            padding: 24px;
            border-radius: 12px;
            border: 2px solid var(--tm-border);
            font-family: var(--vscode-editor-font-family, 'JetBrains Mono', 'Fira Code', 'Consolas', monospace);
            box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.1);
        }

        .progress-container {
            margin: 24px 0;
            padding: 20px;
            background: var(--tm-bg-tertiary);
            border-radius: 12px;
            border: 1px solid var(--tm-border);
        }

        .progress-bar {
            width: 100%;
            height: 20px;
            background-color: var(--tm-bg-primary);
            border-radius: 12px;
            overflow: hidden;
            margin-bottom: 16px;
            border: 2px solid var(--tm-border);
            box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.2);
            position: relative;
        }

        .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #2196f3, #4caf50);
            width: ${progressPercentage}%;
            transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(33, 150, 243, 0.4);
            position: relative;
            overflow: hidden;
        }

        .progress-fill::after {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: linear-gradient(45deg, transparent 30%, rgba(255, 255, 255, 0.2) 50%, transparent 70%);
            animation: shimmer 2s infinite;
        }

        @keyframes shimmer {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(100%); }
        }

        .progress-stats {
            display: flex;
            justify-content: space-between;
            font-size: 14px;
            font-weight: 600;
            color: var(--tm-text-primary);
        }

        .subtask-list {
            list-style: none;
            padding: 0;
            margin: 0;
            display: grid;
            gap: 16px;
        }

        .subtask-item {
            display: flex;
            align-items: center;
            gap: 20px;
            padding: 20px;
            background: var(--tm-bg-primary);
            border: 2px solid var(--tm-border);
            border-radius: 12px;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
            overflow: hidden;
        }

        .subtask-item::before {
            content: '';
            position: absolute;
            left: 0;
            top: 0;
            bottom: 0;
            width: 4px;
            background: var(--tm-accent);
            transform: scaleY(0);
            transition: transform 0.3s ease;
        }

        .subtask-item:hover {
            border-color: var(--tm-border-hover);
            box-shadow: var(--tm-shadow-lg);
            transform: translateY(-2px);
        }

        .subtask-item:hover::before {
            transform: scaleY(1);
        }

        .subtask-checkbox {
            width: 24px;
            height: 24px;
            cursor: pointer;
            accent-color: var(--tm-accent);
            border-radius: 6px;
            transition: all 0.2s ease;
        }

        .subtask-checkbox:hover {
            transform: scale(1.1);
        }

        .subtask-content {
            flex: 1;
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 16px;
        }

        .subtask-title {
            font-weight: 600;
            color: var(--tm-text-primary);
            font-size: 16px;
            flex: 1;
        }

        .subtask-id {
            font-size: 12px;
            color: #ffffff;
            background: var(--tm-accent);
            padding: 6px 12px;
            border-radius: 8px;
            margin-right: 16px;
            font-weight: 700;
            box-shadow: var(--tm-shadow-sm);
        }

        .subtask-status {
            font-size: 12px;
            padding: 6px 16px;
            border-radius: 20px;
            text-transform: uppercase;
            font-weight: 700;
            letter-spacing: 0.5px;
            box-shadow: var(--tm-shadow-sm);
        }

        .subtask-status.completed,
        .subtask-status.done {
            background: var(--tm-status-done);
            color: #ffffff;
        }

        .subtask-status.in-progress {
            background: var(--tm-status-progress);
            color: #ffffff;
        }

        .subtask-status.pending,
        .subtask-status.todo {
            background: var(--tm-status-todo);
            color: #ffffff;
        }

        .subtask-status.blocked {
            background: var(--tm-status-blocked);
            color: #ffffff;
        }

        .action-buttons {
            display: flex;
            gap: 16px;
            flex-wrap: wrap;
            margin-top: 32px;
            padding: 24px;
            background: var(--tm-bg-secondary);
            border-radius: 16px;
            border: 2px solid var(--tm-border);
            box-shadow: var(--tm-shadow-md);
        }

        .action-button {
            background: linear-gradient(135deg, var(--tm-accent), var(--tm-accent-hover));
            color: #ffffff;
            border: none;
            padding: 14px 28px;
            border-radius: 12px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 700;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            box-shadow: var(--tm-shadow-sm);
            position: relative;
            overflow: hidden;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .action-button::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.3), transparent);
            transition: left 0.5s;
        }

        .action-button:hover::before {
            left: 100%;
        }

        .action-button:hover {
            transform: translateY(-3px) scale(1.02);
            box-shadow: var(--tm-shadow-lg);
        }

        .action-button:active {
            transform: translateY(-1px) scale(0.98);
        }

        .action-button.secondary {
            background: linear-gradient(135deg, var(--tm-bg-tertiary), color-mix(in srgb, var(--tm-bg-tertiary) 90%, var(--tm-accent) 10%));
            color: var(--tm-text-primary);
            border: 2px solid var(--tm-border);
        }

        .action-button.secondary:hover {
            background: linear-gradient(135deg, var(--tm-border), color-mix(in srgb, var(--tm-border) 80%, var(--tm-accent) 20%));
            border-color: var(--tm-accent);
        }

        .implementation-details {
            font-family: var(--vscode-editor-font-family, 'JetBrains Mono', 'Fira Code', 'Consolas', monospace);
            font-size: 14px;
            line-height: 1.8;
            background: var(--tm-bg-primary);
            border: 2px solid var(--tm-border);
            border-radius: 12px;
            padding: 24px;
            white-space: pre-wrap;
            overflow-x: auto;
            color: var(--tm-text-primary);
            box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.1);
        }

        .test-strategy {
            background: var(--tm-bg-primary);
            border-left: 6px solid var(--tm-accent);
            padding: 24px;
            margin: 20px 0;
            border-radius: 0 12px 12px 0;
            font-size: 16px;
            line-height: 1.8;
            color: var(--tm-text-primary);
            box-shadow: var(--tm-shadow-sm);
            position: relative;
        }

        .test-strategy::before {
            content: '🧪';
            position: absolute;
            left: -18px;
            top: 20px;
            background: var(--tm-accent);
            color: white;
            width: 36px;
            height: 36px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 18px;
            box-shadow: var(--tm-shadow-md);
        }

        .metadata-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-top: 24px;
        }

        .metadata-item {
            background: var(--tm-bg-primary);
            padding: 20px;
            border-radius: 12px;
            border: 2px solid var(--tm-border);
            box-shadow: var(--tm-shadow-sm);
            transition: all 0.3s ease;
            position: relative;
            overflow: hidden;
        }

        .metadata-item::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 3px;
            background: var(--tm-accent);
            transform: scaleX(0);
            transition: transform 0.3s ease;
        }

        .metadata-item:hover {
            transform: translateY(-2px);
            box-shadow: var(--tm-shadow-md);
        }

        .metadata-item:hover::before {
            transform: scaleX(1);
        }

        .metadata-label {
            font-size: 12px;
            text-transform: uppercase;
            font-weight: 700;
            color: var(--tm-text-secondary);
            margin-bottom: 8px;
            letter-spacing: 1px;
        }

        .metadata-value {
            font-size: 16px;
            font-weight: 600;
            color: var(--tm-text-primary);
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .dependencies-list {
            display: flex;
            flex-direction: column;
            gap: 16px;
        }

        .dependency-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 20px;
            background: var(--tm-bg-primary);
            border: 2px solid var(--tm-border);
            border-radius: 12px;
            transition: all 0.3s ease;
            box-shadow: var(--tm-shadow-sm);
        }

        .dependency-item:hover {
            border-color: var(--tm-border-hover);
            transform: translateY(-2px);
            box-shadow: var(--tm-shadow-md);
        }

        .dependency-id {
            font-weight: 700;
            color: #ffffff;
            background: var(--tm-accent);
            padding: 8px 16px;
            border-radius: 8px;
            font-size: 14px;
            box-shadow: var(--tm-shadow-sm);
        }

        .dependency-status {
            font-size: 14px;
            font-weight: 600;
            color: var(--tm-text-primary);
            display: flex;
            align-items: center;
            gap: 8px;
        }

        /* Responsive design */
        @media (max-width: 768px) {
            .container {
                padding: 16px;
            }
            
            .task-header, .content-section {
                padding: 20px;
                margin-bottom: 20px;
            }
            
            .task-title {
                font-size: 20px;
                flex-direction: column;
                align-items: flex-start;
            }
            
            .metadata-grid {
                grid-template-columns: 1fr;
            }
            
            .action-buttons {
                flex-direction: column;
            }
            
            .action-button {
                text-align: center;
            }
        }

        /* Light theme adjustments */
        @media (prefers-color-scheme: light) {
            :root {
                --tm-bg-primary: #ffffff;
                --tm-bg-secondary: #f8f9fa;
                --tm-bg-tertiary: #e9ecef;
                --tm-text-primary: #333333;
                --tm-text-secondary: #666666;
                --tm-text-muted: #999999;
                --tm-border: #dee2e6;
                --tm-border-hover: #007acc;
                --tm-accent: #1976d2;
                --tm-accent-hover: #1565c0;
            }
        }

        /* High contrast mode support */
        @media (prefers-contrast: high) {
            .task-header,
            .content-section,
            .subtask-item,
            .metadata-item {
                border-width: 3px;
            }
            
            .action-button {
                border: 3px solid var(--tm-text-primary);
            }
            
            .status-badge, .priority-badge {
                border-width: 3px;
                border-color: var(--tm-text-primary);
            }
        }

        /* Reduced motion support */
        @media (prefers-reduced-motion: reduce) {
            * {
                animation-duration: 0.01ms !important;
                animation-iteration-count: 1 !important;
                transition-duration: 0.01ms !important;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="task-header">
                            <div class="task-hierarchy">
                    ${taskDisplayInfo.fullHierarchy}
                    ${taskDisplayInfo.tagInfo ? `<span class="tag-indicator">• ${taskDisplayInfo.tagInfo}</span>` : ''}
                </div>
            <h1 class="task-title">
                <span class="task-id">${isSubtask ? `Subtask ${task.id}` : `Task ${taskDisplayInfo.taskId}`}</span>
                <span class="task-type-badge">${taskDisplayInfo.taskType}</span>
                <span>${task.title}</span>
            </h1>
            ${taskDisplayInfo.parentInfo ? `<div class="parent-info">${taskDisplayInfo.parentInfo}</div>` : ''}
            <div class="task-meta">
                <span class="status-badge status-${task.status}">
                    ${getStatusIcon(task.status)} ${task.status.replace('-', ' ')}
                </span>
                ${isSubtask ? '' : `
                <span class="priority-badge">
                    ${priorityInfo.icon} ${priorityInfo.text}
                </span>
                `}
                ${task.subtasks && task.subtasks.length > 0 ? 
                    `<span class="priority-badge">📝 ${subtaskStats.completed}/${subtaskStats.total} subtasks completed</span>` : 
                    ''
                }
                ${isSubtask ? `<span class="priority-badge">🧩 Subtask</span>` : ''}
            </div>
        </div>

        <div class="content-section">
            <h2 class="section-title">📋 Description</h2>
            <div class="task-description">${task.description || 'No description provided.'}</div>
        </div>

        ${!isSubtask && task.dependencies && task.dependencies.length > 0 ? `
        <div class="content-section">
            <h2 class="section-title">🔗 Dependencies</h2>
            <div class="dependencies-list">
                ${task.dependencies.map((depId: string) => `
                    <div class="dependency-item">
                        <span class="dependency-id">Task ${depId}</span>
                        <span class="dependency-status">✅ Completed</span>
                    </div>
                `).join('')}
            </div>
        </div>
        ` : ''}

        ${task.details ? `
        <div class="content-section">
            <h2 class="section-title">🔧 Implementation Details</h2>
            <div class="implementation-details">${task.details}</div>
        </div>
        ` : ''}

        ${task.subtasks && task.subtasks.length > 0 ? `
        <div class="content-section">
            <h2 class="section-title">📝 Subtasks</h2>
            <div class="progress-container">
                <div class="progress-bar">
                    <div class="progress-fill"></div>
                </div>
                <div class="progress-stats">
                    <span>${progressPercentage}% Complete</span>
                    <span>${subtaskStats.completed} of ${subtaskStats.total} done</span>
                </div>
            </div>
            <ul class="subtask-list">
                ${task.subtasks.map((subtask: Task) => `
                    <li class="subtask-item">
                        <input type="checkbox" class="subtask-checkbox" 
                               ${subtask.status === 'completed' || subtask.status === 'done' ? 'checked' : ''} 
                               onchange="updateSubtaskStatus('${subtask.id}', this.checked ? 'completed' : 'pending')">
                        <div class="subtask-content">
                            <div>
                                <span class="subtask-id">ID: ${subtask.id}</span>
                                <span class="subtask-title">${subtask.title}</span>
                            </div>
                            <span class="subtask-status ${subtask.status}">${subtask.status}</span>
                        </div>
                    </li>
                `).join('')}
            </ul>
        </div>
        ` : ''}

        ${!isSubtask && task.testStrategy ? `
        <div class="content-section">
            <h2 class="section-title">🧪 Test Strategy</h2>
            <div class="test-strategy">${task.testStrategy}</div>
        </div>
        ` : ''}

        <div class="content-section">
            <h2 class="section-title">📊 Metadata</h2>
            <div class="metadata-grid">
                <div class="metadata-item">
                    <div class="metadata-label">Status</div>
                    <div class="metadata-value status-${task.status}">
                        ${getStatusIcon(task.status)} ${task.status.replace('-', ' ')}
                    </div>
                </div>
                ${!isSubtask ? `
                <div class="metadata-item">
                    <div class="metadata-label">Priority</div>
                    <div class="metadata-value" style="color: ${priorityInfo.color}">
                        ${priorityInfo.icon} ${priorityInfo.text}
                    </div>
                </div>
                ` : `
                <div class="metadata-item">
                    <div class="metadata-label">Type</div>
                    <div class="metadata-value">🧩 Subtask</div>
                </div>
                `}
                ${!isSubtask && task.subtasks && task.subtasks.length > 0 ? `
                <div class="metadata-item">
                    <div class="metadata-label">Progress</div>
                    <div class="metadata-value">${progressPercentage}% (${subtaskStats.completed}/${subtaskStats.total})</div>
                </div>
                ` : ''}
                ${task.created ? `
                <div class="metadata-item">
                    <div class="metadata-label">Created</div>
                    <div class="metadata-value">${new Date(task.created).toLocaleDateString()}</div>
                </div>
                ` : ''}
                ${task.updated ? `
                <div class="metadata-item">
                    <div class="metadata-label">Last Updated</div>
                    <div class="metadata-value">${new Date(task.updated).toLocaleDateString()}</div>
                </div>
                ` : ''}
            </div>
        </div>

        <div class="action-buttons">
            <button class="action-button" onclick="updateTaskStatus()">📝 Update Status</button>
            ${!isSubtask ? `
            <button class="action-button secondary" onclick="expandTask()">🔍 Expand Task</button>
            <button class="action-button secondary" onclick="addSubtask()">➕ Add Subtask</button>
            ` : ''}
            <button class="action-button secondary" onclick="startWorking()">🎯 Start Working</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function updateSubtaskStatus(subtaskId, status) {
            vscode.postMessage({
                command: 'updateSubtaskStatus',
                subtaskId: subtaskId,
                status: status
            });
        }

        function updateTaskStatus() {
            vscode.postMessage({
                command: 'updateTaskStatus'
            });
        }

        function expandTask() {
            vscode.postMessage({
                command: 'expandTask'
            });
        }

        function addSubtask() {
            vscode.postMessage({
                command: 'addSubtask'
            });
        }

        function startWorking() {
            vscode.postMessage({
                command: 'startWorking'
            });
        }
    </script>
</body>
</html>`;
}

async function addNewTask(_categoryItem?: vscode.TreeItem): Promise<void> {
    try {
        // Create a multi-step input for task creation
        const taskData = await createTaskInputForm();
        
        if (!taskData) {
            return; // User cancelled
        }

        // Generate next task ID
        const tasks = await taskMasterClient.getTasks();
        const maxId = Math.max(...tasks.map(t => parseInt(t.id)), 0);
        const newTaskId = (maxId + 1).toString();

        // Create the new task object
        const newTaskForSave: TaskFormData = {
            title: taskData.title,
            description: taskData.description || '',
            status: taskData.status || 'todo',
            priority: taskData.priority || 'medium',
            dependencies: taskData.dependencies || []
        };

        // Try CLI method first, then fallback to file-based creation
        try {
            await taskMasterClient.addTask({
                title: taskData.title,
                description: taskData.description || '',
                status: taskData.status || 'todo',
                priority: taskData.priority || 'medium',
                dependencies: Array.isArray(taskData.dependencies) ? taskData.dependencies : 
                              (taskData.dependencies ? [taskData.dependencies] : [])
            }, true, taskData.tagContext); // Force CLI usage, pass selected tag
            
            vscode.window.showInformationMessage(
                `✅ Task "${taskData.title}" created via CLI!`
            );
        } catch (cliError) {
            log(`CLI task creation failed, trying file creation: ${cliError}`);
            await saveNewTask(newTaskForSave);
        vscode.window.showInformationMessage(
            `✅ Task ${newTaskId}: "${taskData.title}" created successfully!`
        );
        }
        
        // Refresh the tree view after a short delay
        setTimeout(() => {
            taskProvider.refresh();
        }, 1000);

    } catch (error) {
        vscode.window.showErrorMessage(`Failed to create task: ${error}`);
    }
}

async function addNewSubtask(parentTask: Task): Promise<void> {
    try {
        // Create input form for subtask
        const subtaskData = await createSubtaskInputForm();
        
        if (!subtaskData) {
            return; // User cancelled
        }

        // Use TaskMasterClient's addSubtask method
        await taskMasterClient.addSubtask(parentTask.id, {
            title: subtaskData.title,
            description: subtaskData.description || '',
            status: subtaskData.status || 'todo',
            priority: subtaskData.priority || 'medium'
        });
        
        // Refresh the tree view
        taskProvider.refresh();
        
        vscode.window.showInformationMessage(
            `✅ Subtask "${subtaskData.title}" added to Task ${parentTask.id}!`
        );

    } catch (error) {
        vscode.window.showErrorMessage(`Failed to create subtask: ${error}`);
    }
}

async function addNewSubtaskWithFallback(parentTask: Task): Promise<void> {
    try {
        // Create input form for subtask
        const subtaskData = await createSubtaskInputForm();
        
        if (!subtaskData) {
            return; // User cancelled
        }

        // Show CLI fallback message
        taskMasterClient.showCLIFallbackMessage(`Adding subtask "${subtaskData.title}"`);

        // Use TaskMasterClient's CLI fallback method
        await taskMasterClient.addSubtaskWithCLI(parentTask.id, {
            title: subtaskData.title,
            description: subtaskData.description || '',
            status: subtaskData.status || 'todo',
            priority: subtaskData.priority || 'medium'
        });
        
        // Refresh the tree view after a short delay to allow CLI command to complete
        setTimeout(() => {
            taskProvider.refresh();
        }, 1000);
        
        vscode.window.showInformationMessage(
            `✅ Subtask "${subtaskData.title}" added to Task ${parentTask.id} via CLI!`
        );

    } catch (error) {
        vscode.window.showErrorMessage(`Failed to create subtask: ${error}`);
    }
}

async function expandTaskWithFallback(task: Task): Promise<void> {
    try {
        const tagContext = taskMasterClient.getTagContext();
        
        // Show CLI fallback message with tag context
        const tagInfo = tagContext.isTaggedFormat ? ` (Tag: ${tagContext.currentTag})` : '';
        taskMasterClient.showCLIFallbackMessage(`Expanding task ${task.id}${tagInfo}`);

        // Ask user if they want to force replace existing subtasks
        let placeHolder = 'How should we handle existing subtasks?';
        if (tagContext.isTaggedFormat) {
            placeHolder = `[Tag: ${tagContext.currentTag}] How should we handle existing subtasks?`;
        }
        
        const forceReplace = await vscode.window.showQuickPick(
            ['No - Append to existing subtasks', 'Yes - Replace existing subtasks'],
            {
                placeHolder,
                ignoreFocusOut: true
            }
        );

        if (!forceReplace) {
            return; // User cancelled
        }

        const force = forceReplace.startsWith('Yes');

        // Log expansion operation with tag context
        log(`Expanding task ${task.id} with force=${force} in tag context: ${tagContext.currentTag}`);
        
        // Use TaskMasterClient's CLI fallback method
        await taskMasterClient.expandTaskWithCLI(task.id, force);
        
        // Refresh the tree view after a short delay to allow CLI command to complete
        setTimeout(() => {
            taskProvider.refresh();
        }, 2000);
        
        const successMessage = tagContext.isTaggedFormat 
            ? `✅ Task ${task.id} expanded via CLI in tag: ${tagContext.currentTag}!`
            : `✅ Task ${task.id} expanded via CLI!`;
        vscode.window.showInformationMessage(successMessage);

    } catch (error) {
        vscode.window.showErrorMessage(`Failed to expand task: ${error}`);
    }
}

async function createTaskInputForm(): Promise<TaskFormData | undefined> {
    // Step 1: Task title (required)
    const title = await vscode.window.showInputBox({
        prompt: 'Enter task title (required)',
        placeHolder: 'e.g., Implement user authentication',
        validateInput: (value) => {
            if (!value || value.trim().length === 0) {
                return 'Task title is required';
            }
            return null;
        }
    });

    if (!title) {
        return undefined;
    }

    // Step 2: Description
    const description = await vscode.window.showInputBox({
        prompt: 'Enter task description (optional)',
        placeHolder: 'e.g., Add JWT-based authentication system for users',
    });

    // Step 3: Priority
    const priority = await vscode.window.showQuickPick(
        [
            { label: 'High', detail: 'Important and urgent' },
            { label: 'Medium', detail: 'Normal priority (default)' },
            { label: 'Low', detail: 'Can wait' },
            { label: 'Critical', detail: 'Blocking other work' }
        ],
        {
            placeHolder: 'Select task priority',
            canPickMany: false
        }
    );

    // Step 4: Status
    const status = await vscode.window.showQuickPick(
        [
            { label: 'todo', detail: 'Ready to work on (default)' },
            { label: 'in-progress', detail: 'Currently being worked on' },
            { label: 'blocked', detail: 'Cannot proceed' }
        ],
        {
            placeHolder: 'Select task status',
            canPickMany: false
        }
    );

    // Step 5: Tag Context Selection
    const tagContext = taskMasterClient.getTagContext();
    let selectedTag = tagContext.currentTag; // Default to current tag
    
    if (tagContext.isTaggedFormat && tagContext.availableTags.length > 1) {
        const tagOptions = tagContext.availableTags.map(tag => ({
            label: tag,
            detail: tag === tagContext.currentTag ? 'Current tag' : 'Available tag',
            picked: tag === tagContext.currentTag
        }));
        
        const selectedTagOption = await vscode.window.showQuickPick(
            tagOptions,
            {
                placeHolder: `Select tag context for new task (current: ${tagContext.currentTag})`,
                canPickMany: false
            }
        );
        
        if (selectedTagOption) {
            selectedTag = selectedTagOption.label;
        }
    }

    // Step 6: Dependencies (optional)
    const tasks = await taskMasterClient.getTasks();
    const availableTasks = tasks.map(task => ({
        label: `${task.id}: ${task.title}`,
        detail: `Status: ${task.status}, Priority: ${task.priority}`,
        taskId: task.id
    }));

    let dependencies: string[] = [];
    if (availableTasks.length > 0) {
        const selectedDeps = await vscode.window.showQuickPick(
            availableTasks,
            {
                placeHolder: 'Select dependencies (optional) - tasks that must be completed first',
                canPickMany: true
            }
        );
        
        if (selectedDeps) {
            dependencies = selectedDeps.map(dep => dep.taskId);
        }
    }

    return {
        title: title.trim(),
        description: description?.trim() || '',
        priority: (priority?.label.toLowerCase() as TaskPriority) || 'medium',
        status: (status?.label as TaskStatus) || 'todo',
        dependencies,
        tagContext: selectedTag
    };
}

async function createSubtaskInputForm(): Promise<SubtaskFormData | undefined> {
    // Step 1: Subtask title (required)
    const title = await vscode.window.showInputBox({
        prompt: 'Enter subtask title (required)',
        placeHolder: 'e.g., Set up JWT token validation',
        validateInput: (value) => {
            if (!value || value.trim().length === 0) {
                return 'Subtask title is required';
            }
            return null;
        }
    });

    if (!title) {
        return undefined;
    }

    // Step 2: Description
    const description = await vscode.window.showInputBox({
        prompt: 'Enter subtask description (optional)',
        placeHolder: 'e.g., Implement middleware to validate JWT tokens',
    });

    // Step 3: Priority (simpler for subtasks)
    const priority = await vscode.window.showQuickPick(
        ['high', 'medium', 'low'],
        {
            placeHolder: 'Select subtask priority (default: medium)',
            canPickMany: false
        }
    );

    // Step 4: Status (simpler for subtasks)
    const status = await vscode.window.showQuickPick(
        ['todo', 'in-progress', 'done'],
        {
            placeHolder: 'Select subtask status (default: todo)',
            canPickMany: false
        }
    );

    return {
        title: title.trim(),
        description: description?.trim() || '',
        priority: (priority as TaskPriority) || 'medium',
        status: (status as TaskStatus) || 'todo'
    };
}

async function saveNewTask(task: TaskFormData): Promise<void> {
    try {
        // Read current tasks.json
        const tasksJsonPath = path.join(taskMasterClient.getTaskmasterPath(), 'tasks', 'tasks.json');
        
        if (fs.existsSync(tasksJsonPath)) {
            const tasksData = fs.readFileSync(tasksJsonPath, 'utf8');
            const parsed = JSON.parse(tasksData);
            const tasks = Array.isArray(parsed) ? parsed : parsed.tasks || [];
            
            // Add the new task
            tasks.push(task);
            
            // Write back to file
            const updatedData = Array.isArray(parsed) ? tasks : { ...parsed, tasks };
            fs.writeFileSync(tasksJsonPath, JSON.stringify(updatedData, null, 2));
        } else {
            // Create new tasks.json file
            const newTasksFile = {
                tasks: [task]
            };
            fs.writeFileSync(tasksJsonPath, JSON.stringify(newTasksFile, null, 2));
        }
    } catch (error) {
        throw new Error(`Failed to save task: ${error}`);
    }
}

async function editTask(task: Task): Promise<void> {
    try {
        const tagContext = getTagContext(taskMasterClient);
        logTagOperation('Edit Task Dialog', tagContext, { taskId: task.id, taskTitle: task.title });
        
        // Create a comprehensive edit dialog for task properties
        const editData = await createTaskEditForm(task);
        
        if (!editData) {
            return; // User cancelled
        }

        // Update task using TaskMasterClient
        await updateTaskData(task.id, editData);
        
        // Refresh the tree view
        taskProvider.refresh();
        
        const successMessage = formatTagSuccessMessage(
            `✅ Task ${task.id}: "${editData.title}" updated successfully!`,
            tagContext
        );
        vscode.window.showInformationMessage(successMessage);

    } catch (error) {
        vscode.window.showErrorMessage(`Failed to edit task: ${error}`);
    }
}

async function editTaskTitle(task: Task): Promise<void> {
    try {
        const tagContext = getTagContext(taskMasterClient);
        logTagOperation('Edit Task Title', tagContext, { taskId: task.id, currentTitle: task.title });
        
        // Simple inline title editing with tag-aware prompt
        const newTitle = await vscode.window.showInputBox({
            prompt: getTagAwarePlaceholder(tagContext, 'Enter new task title'),
            value: task.title,
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Task title cannot be empty';
                }
                return null;
            }
        });

        if (!newTitle || newTitle === task.title) {
            return; // User cancelled or no change
        }

        // Update just the title
        await updateTaskData(task.id, { 
            title: newTitle.trim(),
            updated: new Date().toISOString()
        });
        
        // Refresh the tree view
        taskProvider.refresh();
        
        const successMessage = formatTagSuccessMessage(
            `✅ Task ${task.id} title updated to "${newTitle}"`,
            tagContext
        );
        vscode.window.showInformationMessage(successMessage);

    } catch (error) {
        vscode.window.showErrorMessage(`Failed to edit task title: ${error}`);
    }
}

async function deleteTask(task: Task): Promise<void> {
    try {
        const tagContext = getTagContext(taskMasterClient);
        logTagOperation('Delete Task', tagContext, { taskId: task.id, taskTitle: task.title });
        
        // Confirmation dialog with tag context
        const confirmMessage = tagContext.isTaggedFormat 
            ? `[Tag: ${tagContext.currentTag}] Are you sure you want to delete Task ${task.id}: "${task.title}"?`
            : `Are you sure you want to delete Task ${task.id}: "${task.title}"?`;
            
        const confirm = await vscode.window.showWarningMessage(
            confirmMessage,
            { modal: true },
            'Delete',
            'Cancel'
        );

        if (confirm !== 'Delete') {
            return;
        }

        // Check if this is a subtask (contains dot)
        if (task.id?.toString().includes('.')) {
            // Handle subtask deletion
            const parts = task.id.toString().split('.');
            const parentId = parts.slice(0, -1).join('.');
            const subtaskId = parts[parts.length - 1];
            
            if (subtaskId) {
                await taskMasterClient.removeSubtask(parentId, subtaskId);
            } else {
                throw new Error(`Invalid subtask ID structure: ${task.id}`);
            }
        } else {
            // Handle main task deletion
            await deleteMainTask(task.id);
        }
        
        // Refresh the tree view
        taskProvider.refresh();
        
        const successMessage = formatTagSuccessMessage(
            `🗑️ Task ${task.id}: "${task.title}" deleted successfully`,
            tagContext
        );
        vscode.window.showInformationMessage(successMessage);

    } catch (error) {
        vscode.window.showErrorMessage(`Failed to delete task: ${error}`);
    }
}

async function createTaskEditForm(task: Task): Promise<TaskUpdateData | undefined> {
    // Step 1: Title
    const title = await vscode.window.showInputBox({
        prompt: 'Edit task title',
        value: task.title,
        validateInput: (value) => {
            if (!value || value.trim().length === 0) {
                return 'Task title is required';
            }
            return null;
        }
    });

    if (title === undefined) {
        return undefined; // User cancelled
    }

    // Step 2: Description
    const description = await vscode.window.showInputBox({
        prompt: 'Edit task description',
        value: task.description || '',
        placeHolder: 'Enter task description (optional)'
    });

    if (description === undefined) {
        return undefined;
    }

    // Step 3: Priority
    const currentPriority = task.priority || 'medium';
    const priorityOptions = [
        { label: 'Critical', detail: 'Blocking other work', value: 'critical' },
        { label: 'High', detail: 'Important and urgent', value: 'high' },
        { label: 'Medium', detail: 'Normal priority', value: 'medium' },
        { label: 'Low', detail: 'Can wait', value: 'low' }
    ];
    
    const priority = await vscode.window.showQuickPick(
        priorityOptions.map(p => ({
            ...p,
            picked: p.value === currentPriority
        })),
        {
            placeHolder: `Current priority: ${currentPriority}. Select new priority:`,
            canPickMany: false
        }
    );

    if (priority === undefined) {
        return undefined;
    }

    // Step 4: Status
    const currentStatus = task.status || 'todo';
    const statusOptions = [
        { label: 'todo', detail: 'Ready to work on' },
        { label: 'in-progress', detail: 'Currently being worked on' },
        { label: 'completed', detail: 'Task is finished' },
        { label: 'blocked', detail: 'Cannot proceed' }
    ];
    
    const status = await vscode.window.showQuickPick(
        statusOptions.map(s => ({
            ...s,
            picked: s.label === currentStatus
        })),
        {
            placeHolder: `Current status: ${currentStatus}. Select new status:`,
            canPickMany: false
        }
    );

    if (status === undefined) {
        return undefined;
    }

    // Step 5: Dependencies (optional)
    const tasks = await taskMasterClient.getTasks();
    const availableTasks = tasks
        .filter(t => t.id.toString() !== task.id.toString()) // Don't include self
        .map(t => ({
            label: `${t.id}: ${t.title}`,
            detail: `Status: ${t.status}, Priority: ${t.priority}`,
            taskId: t.id,
            picked: task.dependencies ? task.dependencies.includes(t.id.toString()) : false
        }));

    let dependencies: string[] = task.dependencies || [];
    if (availableTasks.length > 0) {
        const selectedDeps = await vscode.window.showQuickPick(
            availableTasks,
            {
                placeHolder: 'Select dependencies (tasks that must be completed first)',
                canPickMany: true
            }
        );
        
        if (selectedDeps !== undefined) {
            dependencies = selectedDeps.map(dep => (dep as any).taskId);
        }
    }

    return {
        title: title.trim(),
        description: description?.trim() || '',
        priority: priority.value as TaskPriority,
        status: status.label as TaskStatus,
        dependencies,
        updated: new Date().toISOString()
    };
}

async function updateTaskData(taskId: string, updates: TaskUpdateData): Promise<void> {
    try {
        // Check if this is a subtask by looking for a parent task that contains it
        const allTasks = await taskMasterClient.getTasks();
        let isSubtask = false;
        let parentTaskId: string | undefined;
        
        // Search for a parent task that contains this task as a subtask
        const parentTask = allTasks.find(mainTask => 
            mainTask.subtasks?.some(st => st.id.toString() === taskId.toString())
        );
        
        if (parentTask) {
            isSubtask = true;
            parentTaskId = parentTask.id.toString();
        }
        
        if (isSubtask && parentTaskId) {
            // Handle subtask update using the proper method
            await taskMasterClient.updateSubtask(parentTaskId, taskId, updates);
        } else {
            // Handle main task update using the proper method that supports tagged format
            await taskMasterClient.updateTask(taskId, updates);
        }
    } catch (error) {
        throw new Error(`Failed to update task: ${error}`);
    }
}

async function deleteMainTask(taskId: string): Promise<void> {
    try {
        // Use the TaskMasterClient method that supports tagged format
        await taskMasterClient.deleteTask(taskId);
        
        // TODO: Handle dependency cleanup - this might need to be added to TaskMasterClient.deleteTask()
        // For now, the basic deletion works with tagged format
    } catch (error) {
        throw new Error(`Failed to delete task: ${error}`);
    }
}

/**
 * Set task status with proper context handling for both main tasks and subtasks
 */
async function setTaskStatusWithContext(task: Task, newStatus: TaskStatus, parentTaskId?: string): Promise<void> {
    try {
        const oldStatus = task.status;
        
        if (oldStatus === newStatus) {
            const logDetails: UserInteractionDetails = { 
                taskId: task.id, 
                status: newStatus as any
            };
            if (parentTaskId) {
                logDetails.parentTaskId = parentTaskId;
            }
            logUserInteraction('Status change skipped - no change', logDetails, 'status-update');
            vscode.window.showInformationMessage(`Task ${task.id} is already ${newStatus}`);
            return;
        }

        const tagContext = taskMasterClient.getTagContext();
        const executeLogDetails: UserInteractionDetails = { 
            taskId: task.id, 
            oldStatus: oldStatus as any, 
            newStatus: newStatus as any,
            taskTitle: task.title,
            currentTag: tagContext.currentTag as any,
            isTaggedFormat: tagContext.isTaggedFormat as any
        };
        if (parentTaskId) {
            executeLogDetails.parentTaskId = parentTaskId;
        }
        logUserInteraction('Status change executing', executeLogDetails, 'status-update');

        try {
            // Determine if this is a subtask and use the appropriate method
            // Check if this task ID contains a dot AND we have a parentTaskId
            const isSubtask = parentTaskId && task.id?.toString().includes('.');
            
            if (isSubtask) {
                // This is a subtask - use the new setSubtaskStatus method
                log(`Setting subtask status: subtaskId=${task.id}, parentTaskId=${parentTaskId}, status=${newStatus}`);
                await taskMasterClient.setSubtaskStatus(parentTaskId, task.id, newStatus);
            } else {
                // This is a main task - use the regular setTaskStatus method
                log(`Setting main task status: taskId=${task.id}, status=${newStatus}`);
                await taskMasterClient.setTaskStatus(task.id, newStatus);
            }
        } catch (error) {
            log(`Status update failed: ${error}`);
            throw error;
        }
        
        // Refresh the tree view
        taskProvider.refresh();
        
        // Show status-specific messages
        const statusMessages: { [key: string]: string } = {
            'todo': `⭕ Task ${task.id} marked as todo`,
            'in-progress': `🔄 Task ${task.id} marked as in progress`,
            'completed': `✅ Task ${task.id} marked as completed`,
            'blocked': `❌ Task ${task.id} marked as blocked`
        };
        
        let message = statusMessages[newStatus] || `📝 Task ${task.id} status changed to ${newStatus}`;
        
        // Add parent context for subtasks
        if (parentTaskId) {
            message = message.replace(`Task ${task.id}`, `Subtask ${task.id} (in Task ${parentTaskId})`);
        }
        
        vscode.window.showInformationMessage(message);
        
        const completedLogDetails: UserInteractionDetails = { 
            taskId: task.id, 
            oldStatus: oldStatus as any, 
            newStatus: newStatus as any,
            message: message as any,
            currentTag: tagContext.currentTag as any,
            isTaggedFormat: tagContext.isTaggedFormat as any
        };
        if (parentTaskId) {
            completedLogDetails.parentTaskId = parentTaskId;
        }
        logUserInteraction('Status change completed', completedLogDetails, 'status-update');

    } catch (error) {
        const failedLogDetails: UserInteractionDetails = { 
            taskId: task.id, 
            targetStatus: newStatus as any,
            error: error instanceof Error ? error.message : String(error)
        };
        if (parentTaskId) {
            failedLogDetails.parentTaskId = parentTaskId;
        }
        logUserInteraction('Status change failed', failedLogDetails, 'status-update');
        vscode.window.showErrorMessage(`Failed to change status: ${error}`);
        throw error;
    }
}

/**
 * Legacy setTaskStatus function for backward compatibility
 */
async function setTaskStatus(task: Task, newStatus: TaskStatus): Promise<void> {
    try {
        const oldStatus = task.status;
        
        if (oldStatus === newStatus) {
            logUserInteraction('Status change skipped - no change', { 
                taskId: task.id, 
                status: newStatus 
            }, 'status-update');
            vscode.window.showInformationMessage(`Task ${task.id} is already ${newStatus}`);
            return;
        }

        const tagContext = taskMasterClient.getTagContext();
        logUserInteraction('Status change executing', { 
            taskId: task.id, 
            oldStatus, 
            newStatus,
            taskTitle: task.title,
            currentTag: tagContext.currentTag,
            isTaggedFormat: tagContext.isTaggedFormat
        }, 'status-update');

        try {
            // Try CLI fallback method first for consistency
            await taskMasterClient.setTaskStatusWithCLI(task.id, newStatus);
        } catch (cliError) {
            log(`CLI status update failed, trying file update: ${cliError}`);
            // Fallback to direct file update
        await updateTaskData(task.id, { 
            status: newStatus,
            updated: new Date().toISOString()
        });
        }
        
        // Refresh the tree view
        taskProvider.refresh();
        
        // Show status-specific messages
        const statusMessages: { [key: string]: string } = {
            'todo': `⭕ Task ${task.id} marked as todo`,
            'in-progress': `🔄 Task ${task.id} marked as in progress`,
            'completed': `✅ Task ${task.id} marked as completed`,
            'blocked': `❌ Task ${task.id} marked as blocked`
        };
        
        const message = statusMessages[newStatus] || `📝 Task ${task.id} status changed to ${newStatus}`;
        vscode.window.showInformationMessage(message);
        
        logUserInteraction('Status change completed', { 
            taskId: task.id, 
            oldStatus, 
            newStatus,
            message,
            currentTag: tagContext.currentTag,
            isTaggedFormat: tagContext.isTaggedFormat
        }, 'status-update');

    } catch (error) {
        logUserInteraction('Status change failed', { 
            taskId: task.id, 
            targetStatus: newStatus,
            error: error instanceof Error ? error.message : String(error)
        }, 'status-update');
        vscode.window.showErrorMessage(`Failed to change status: ${error}`);
        throw error;
    }
}

async function setTaskStatusInteractive(task: Task): Promise<void> {
    try {
        const statusOptions = [
            { label: 'Todo', detail: 'Not started', value: 'todo' },
            { label: 'In Progress', detail: 'Currently working on', value: 'in-progress' },
            { label: 'Completed', detail: 'Finished', value: 'completed' },
            { label: 'Blocked', detail: 'Waiting on external dependency', value: 'blocked' }
        ];
        
        const currentStatus = task.status || 'todo';
        const tagContext = taskMasterClient.getTagContext();
        
        logUserInteraction('Status picker opened', { 
            taskId: task.id,
            currentStatus,
            currentTag: tagContext.currentTag,
            isTaggedFormat: tagContext.isTaggedFormat,
            availableOptions: statusOptions.map(o => o.value)
        }, 'status-dialog');
        
        // Create placeholder text that includes tag context information
        let placeHolder = `Current status: ${currentStatus}. Select new status:`;
        if (tagContext.isTaggedFormat) {
            placeHolder = `[Tag: ${tagContext.currentTag}] Current status: ${currentStatus}. Select new status:`;
        }
        
        const status = await vscode.window.showQuickPick(
            statusOptions.map(s => ({
                ...s,
                picked: s.value === currentStatus
            })),
            {
                placeHolder,
                canPickMany: false
            }
        );

        if (!status) {
            logUserInteraction('Status picker cancelled', { taskId: task.id }, 'status-dialog');
            return; // User cancelled
        }
        
        if (status.value === currentStatus) {
            logUserInteraction('Status picker closed - no change', { 
                taskId: task.id, 
                selectedStatus: status.value 
            }, 'status-dialog');
            return; // No change
        }

        logUserInteraction('Status selected from picker', { 
            taskId: task.id,
            oldStatus: currentStatus,
            newStatus: status.value
        }, 'status-dialog');

        await setTaskStatus(task, status.value as TaskStatus);

    } catch (error) {
        logUserInteraction('Interactive status change failed', { 
            taskId: task.id,
            error: error instanceof Error ? error.message : String(error)
        }, 'status-dialog');
        vscode.window.showErrorMessage(`Failed to change task status: ${error}`);
    }
}

async function changePriority(task: Task): Promise<void> {
    try {
        const tagContext = getTagContext(taskMasterClient);
        logTagOperation('Change Priority', tagContext, { taskId: task.id, currentPriority: task.priority });
        
        const priorityOptions = [
            { label: 'Critical', detail: 'Blocking other work', value: 'critical' },
            { label: 'High', detail: 'Important and urgent', value: 'high' },
            { label: 'Medium', detail: 'Normal priority', value: 'medium' },
            { label: 'Low', detail: 'Can wait', value: 'low' }
        ];
        
        const currentPriority = task.priority || 'medium';
        const placeHolder = getTagAwarePlaceholder(
            tagContext, 
            `Current priority: ${currentPriority}. Select new priority:`
        );
        
        const priority = await vscode.window.showQuickPick(
            priorityOptions.map(p => ({
                ...p,
                picked: p.value === currentPriority
            })),
            {
                placeHolder,
                canPickMany: false
            }
        );

        if (!priority || priority.value === currentPriority) {
            return; // User cancelled or no change
        }

        // Update priority
        await updateTaskData(task.id, { 
            priority: priority.value as TaskPriority,
            updated: new Date().toISOString()
        });
        
        // Refresh the tree view
        taskProvider.refresh();
        
        const successMessage = formatTagSuccessMessage(
            `⭐ Task ${task.id} priority changed to ${priority.value}`,
            tagContext
        );
        vscode.window.showInformationMessage(successMessage);

    } catch (error) {
        vscode.window.showErrorMessage(`Failed to change priority: ${error}`);
    }
}

async function setDependencies(task: Task): Promise<void> {
    try {
        const tagContext = getTagContext(taskMasterClient);
        logTagOperation('Set Dependencies', tagContext, { 
            taskId: task.id, 
            currentDependencies: task.dependencies 
        });
        
        // Get all available tasks (excluding self)
        const tasks = await taskMasterClient.getTasks();
        const availableTasks = tasks
            .filter(t => t.id.toString() !== task.id.toString()) // Don't include self
            .map(t => ({
                label: `${t.id}: ${t.title}`,
                detail: `Status: ${t.status}, Priority: ${t.priority}`,
                taskId: t.id,
                picked: task.dependencies ? task.dependencies.includes(t.id.toString()) : false
            }));

        if (availableTasks.length === 0) {
            const message = formatTagSuccessMessage(
                'No other tasks available to set as dependencies.',
                tagContext
            );
            vscode.window.showInformationMessage(message);
            return;
        }

        const placeHolder = getTagAwarePlaceholder(
            tagContext,
            'Select dependencies (tasks that must be completed before this task)'
        );
        
        const selectedDeps = await vscode.window.showQuickPick(
            availableTasks,
            {
                placeHolder,
                canPickMany: true
            }
        );
        
        if (selectedDeps === undefined) {
            return; // User cancelled
        }

        const newDependencies = selectedDeps.map(dep => (dep as any).taskId);

        // Update dependencies
        await updateTaskData(task.id, { 
            dependencies: newDependencies,
            updated: new Date().toISOString()
        });
        
        // Refresh the tree view
        taskProvider.refresh();
        
        let successMessage: string;
        if (newDependencies.length === 0) {
            successMessage = `🔗 Task ${task.id} dependencies cleared`;
        } else {
            successMessage = `🔗 Task ${task.id} now depends on: ${newDependencies.join(', ')}`;
        }
        
        vscode.window.showInformationMessage(
            formatTagSuccessMessage(successMessage, tagContext)
        );

    } catch (error) {
        vscode.window.showErrorMessage(`Failed to set dependencies: ${error}`);
    }
}

async function copyTaskDetails(task: Task): Promise<void> {
    try {
        const tagContext = getTagContext(taskMasterClient);
        logTagOperation('Copy Task Details', tagContext, { taskId: task.id });
        
        let details = `Task ${task.id}: ${task.title}
Status: ${task.status}
Priority: ${task.priority || 'Not set'}
Description: ${task.description || 'No description'}

Details:
${task.details || 'No details available'}

Dependencies: ${task.dependencies?.length ? task.dependencies.join(', ') : 'None'}

Subtasks: ${task.subtasks?.length || 0} subtask(s)
        ${task.subtasks?.map((st: Task, index: number) => `  ${index + 1}. ${st.title} (${st.status})`).join('\n') || ''}

Test Strategy:
${task.testStrategy || 'No test strategy defined'}`;

        // Add tag context information if in tagged format
        if (tagContext.isTaggedFormat) {
            details = `Tag Context: ${tagContext.currentTag}

${details}`;
        }

        await vscode.env.clipboard.writeText(details);
        
        const successMessage = formatTagSuccessMessage(
            `📋 Task ${task.id} details copied to clipboard`,
            tagContext
        );
        vscode.window.showInformationMessage(successMessage);
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to copy task details: ${error}`);
    }
}

// Search and Filter Functions
async function showSearchDialog(): Promise<void> {
    const searchTerm = await vscode.window.showInputBox({
        placeHolder: 'Enter search term (task title, description, or ID)',
        prompt: 'Search tasks'
        });

    if (searchTerm) {
        // For now, just show the search term and refresh
        taskProvider.refresh();
        vscode.window.showInformationMessage(`🔍 Searching for: ${searchTerm}`);
    }
}

async function showStatusFilterDialog(): Promise<void> {
    const statuses = ['pending', 'in-progress', 'completed', 'blocked', 'cancelled'];
    const selected = await vscode.window.showQuickPick(statuses, {
        placeHolder: 'Select status to filter by',
        canPickMany: true
        });

    if (selected && selected.length > 0) {
        // For now, just show the filter and refresh
    taskProvider.refresh();
        vscode.window.showInformationMessage(`📊 Filtering by status: ${selected.join(', ')}`);
    }
}

async function expandAllTasks(treeView: vscode.TreeView<vscode.TreeItem>): Promise<void> {
    log('Expanding all tasks in the tree view.');
    if (taskProvider) {
        // First set internal state to expanded
        taskProvider.expandAll();
        
        // Recursive function to expand an item and all its children
        async function expandItemAndChildren(item: vscode.TreeItem, depth: number = 0): Promise<void> {
            const indent = '  '.repeat(depth);
            
            if (item.collapsibleState !== vscode.TreeItemCollapsibleState.None) {
                try {
                    await treeView.reveal(item, { expand: true, select: false, focus: false });
                    log(`${indent}Expanded item: ${item.label}`);
                    
                    // Get children and expand them recursively
                    const children = await taskProvider.getChildren(item as any);
                    for (const child of children) {
                        await expandItemAndChildren(child, depth + 1);
                    }
                } catch (error) {
                    log(`${indent}Failed to expand item ${item.label}: ${error}`);
                }
            } else {
                log(`${indent}Skipped non-expandable item: ${item.label}`);
            }
        }
        
        // Then use TreeView API to reveal and expand all items recursively
        try {
            const rootItems = await taskProvider.getChildren();
            let totalExpandedCount = 0;
            let totalSkippedCount = 0;
            
            // Expand each root item and all its descendants
            for (const item of rootItems) {
                await expandItemAndChildren(item);
                
                // Count expanded items at all levels
                async function countItems(item: vscode.TreeItem): Promise<ExpandItemResult> {
                    let expanded = 0;
                    let skipped = 0;
                    
                    if (item.collapsibleState !== vscode.TreeItemCollapsibleState.None) {
                        expanded = 1;
                        const children = await taskProvider.getChildren(item as any);
                        for (const child of children) {
                            const childCounts = await countItems(child);
                            expanded += childCounts.expanded;
                            skipped += childCounts.skipped;
                        }
                    } else {
                        skipped = 1;
                    }
                    
                    return { expanded, skipped };
                }
                
                const counts = await countItems(item);
                totalExpandedCount += counts.expanded;
                totalSkippedCount += counts.skipped;
            }
            
            logUserInteraction('Tree expansion completed', {
                totalRootItems: rootItems.length,
                totalExpandedItems: totalExpandedCount,
                totalSkippedItems: totalSkippedCount
            }, 'tree-view');
            log(`Successfully expanded all expandable tree items: ${totalExpandedCount} expanded, ${totalSkippedCount} non-expandable items skipped.`);
        } catch (error) {
            logUserInteraction('Tree expansion failed', { error: error instanceof Error ? error.message : String(error) }, 'tree-view');
            log(`Error during tree expansion: ${error}`);
            throw error; // Re-throw to let the command handler catch it
        }
    }
}

// Removed collapseAllTasks function - not currently used
// Can be re-added when collapse all command is implemented

// Tag Management Handler Functions
async function switchTagHandler(): Promise<void> {
    try {
        const tagContext = getTagContext(taskMasterClient);
        logTagOperation('Switch Tag Handler', tagContext);
        
        if (!tagContext.isTaggedFormat) {
            vscode.window.showInformationMessage('This project is not using the tagged task format. No tags to switch between.');
            return;
        }
        
        if (tagContext.availableTags.length <= 1) {
            vscode.window.showInformationMessage('Only one tag available. Create additional tags to switch between them.');
            return;
        }
        
        const tagOptions = tagContext.availableTags.map(tag => ({
            label: tag,
            detail: tag === tagContext.currentTag ? '✓ Current tag' : 'Available tag',
            description: tag === 'master' ? 'Default tag' : ''
        }));
        
        const selectedTag = await vscode.window.showQuickPick(tagOptions, {
            placeHolder: `Current tag: ${tagContext.currentTag} • Select a tag to switch to`,
            ignoreFocusOut: true
        });
        
        if (!selectedTag) {
            return; // User cancelled
        }
        
        if (selectedTag.label === tagContext.currentTag) {
            vscode.window.showInformationMessage(`Already using tag: ${selectedTag.label}`);
            return;
        }
        
        // Switch to the selected tag
        await taskProvider.switchTag(selectedTag.label);
        
        // Update status bar to reflect the tag change
        tagStatusBar.forceUpdate();
        
        const successMessage = `🏷️ Switched to tag: ${selectedTag.label}`;
        vscode.window.showInformationMessage(successMessage);
        
        log(`Successfully switched from tag '${tagContext.currentTag}' to '${selectedTag.label}'`);
        
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to switch tag: ${error}`);
        log(`Error in switchTagHandler: ${error}`);
    }
}

async function createTagHandler(): Promise<void> {
    try {
        const tagContext = getTagContext(taskMasterClient);
        logTagOperation('Create Tag Handler', tagContext);
        
        if (!tagContext.isTaggedFormat) {
            vscode.window.showInformationMessage('This project is not using the tagged task format. Initialize tagged format first.');
            return;
        }
        
        const tagName = await vscode.window.showInputBox({
            placeHolder: 'Enter new tag name (e.g., feature-branch, sprint-2)',
            prompt: 'Create a new tag for organizing tasks',
            validateInput: (value: string) => {
                if (!value || value.trim().length === 0) {
                    return 'Tag name cannot be empty';
                }
                if (value.includes(' ')) {
                    return 'Tag name cannot contain spaces. Use hyphens or underscores instead.';
                }
                if (tagContext.availableTags.includes(value.trim())) {
                    return 'Tag already exists. Choose a different name.';
                }
                if (value.length > 50) {
                    return 'Tag name is too long. Keep it under 50 characters.';
                }
                return null;
            }
        });
        
        if (!tagName) {
            return; // User cancelled
        }
        
        const trimmedTagName = tagName.trim();
        
        // Create the tag via TaskMasterClient
        await taskMasterClient.createTag(trimmedTagName);
        
        // Ask if user wants to switch to the new tag
        const switchToNew = await vscode.window.showInformationMessage(
            `✅ Tag '${trimmedTagName}' created successfully!`,
            'Switch to New Tag',
            'Stay on Current Tag'
        );
        
        if (switchToNew === 'Switch to New Tag') {
            await taskProvider.switchTag(trimmedTagName);
            vscode.window.showInformationMessage(`🏷️ Switched to new tag: ${trimmedTagName}`);
        }
        
        // Update status bar to reflect the changes
        tagStatusBar.forceUpdate();
        
        log(`Successfully created tag '${trimmedTagName}'`);
        
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to create tag: ${error}`);
        log(`Error in createTagHandler: ${error}`);
    }
}

async function deleteTagHandler(): Promise<void> {
    try {
        const tagContext = getTagContext(taskMasterClient);
        logTagOperation('Delete Tag Handler', tagContext);
        
        if (!tagContext.isTaggedFormat) {
            vscode.window.showInformationMessage('This project is not using the tagged task format. No tags to delete.');
            return;
        }
        
        // Filter out master tag from deletion options
        const deletableTags = tagContext.availableTags.filter(tag => tag !== 'master');
        
        if (deletableTags.length === 0) {
            vscode.window.showInformationMessage('No tags available for deletion. The master tag cannot be deleted.');
            return;
        }
        
        const tagOptions = deletableTags.map(tag => ({
            label: tag,
            detail: tag === tagContext.currentTag ? '⚠️ Current tag - will switch to master after deletion' : 'Available for deletion',
            description: 'Click to delete this tag and all its tasks'
        }));
        
        const selectedTag = await vscode.window.showQuickPick(tagOptions, {
            placeHolder: 'Select a tag to delete (master tag cannot be deleted)',
            ignoreFocusOut: true
        });
        
        if (!selectedTag) {
            return; // User cancelled
        }
        
        // Confirm deletion
        const confirmMessage = selectedTag.label === tagContext.currentTag
            ? `⚠️ You are about to delete the current tag '${selectedTag.label}' and ALL its tasks. You will be switched to the master tag. This action cannot be undone.`
            : `⚠️ You are about to delete tag '${selectedTag.label}' and ALL its tasks. This action cannot be undone.`;
            
        const confirmation = await vscode.window.showWarningMessage(
            confirmMessage,
            { modal: true },
            'Delete Tag',
            'Cancel'
        );
        
        if (confirmation !== 'Delete Tag') {
            return; // User cancelled
        }
        
        // Delete the tag via TaskMasterClient
        await taskMasterClient.deleteTag(selectedTag.label);
        
        // If we deleted the current tag, switch to master
        if (selectedTag.label === tagContext.currentTag) {
            await taskProvider.switchTag('master');
            vscode.window.showInformationMessage(`🗑️ Tag '${selectedTag.label}' deleted. Switched to master tag.`);
        } else {
            vscode.window.showInformationMessage(`🗑️ Tag '${selectedTag.label}' deleted successfully.`);
        }
        
        // Update status bar to reflect the changes
        tagStatusBar.forceUpdate();
        
        log(`Successfully deleted tag '${selectedTag.label}'`);
        
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to delete tag: ${error}`);
        log(`Error in deleteTagHandler: ${error}`);
    }
}

async function listTagsHandler(): Promise<void> {
    try {
        const tagContext = getTagContext(taskMasterClient);
        logTagOperation('List Tags Handler', tagContext);
        
        if (!tagContext.isTaggedFormat) {
            vscode.window.showInformationMessage('This project is not using the tagged task format. No tags available.');
            return;
        }
        
        // Get detailed tag information
        const tagInfoList: string[] = [];
        
        for (const tagName of tagContext.availableTags) {
            const isCurrentTag = tagName === tagContext.currentTag;
            const tasks = await taskMasterClient.getTasks(); // This gets tasks for current tag
            
            let taskCount = 0;
            if (isCurrentTag) {
                taskCount = tasks.length;
            } else {
                // Switch temporarily to get task count for other tags
                try {
                    await taskMasterClient.switchTag(tagName);
                    const otherTasks = await taskMasterClient.getTasks();
                    taskCount = otherTasks.length;
                } catch (error) {
                    log(`Error getting task count for tag '${tagName}': ${error}`);
                    taskCount = 0;
                }
            }
            
            const currentIndicator = isCurrentTag ? ' ✓ (current)' : '';
            const masterIndicator = tagName === 'master' ? ' (default)' : '';
            tagInfoList.push(`🏷️ ${tagName}${currentIndicator}${masterIndicator} - ${taskCount} task(s)`);
        }
        
        // Switch back to original tag if we switched
        if (tagContext.currentTag !== await taskMasterClient.getCurrentTag()) {
            await taskMasterClient.switchTag(tagContext.currentTag);
        }
        
        const tagListMessage = `Available Tags:\n\n${tagInfoList.join('\n')}\n\nTotal: ${tagContext.availableTags.length} tag(s)`;
        
        const action = await vscode.window.showInformationMessage(
            tagListMessage,
            'Switch Tag',
            'Create New Tag',
            'Close'
        );
        
        if (action === 'Switch Tag') {
            await switchTagHandler();
        } else if (action === 'Create New Tag') {
            await createTagHandler();
        }
        
        log(`Listed ${tagContext.availableTags.length} tags`);
        
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to list tags: ${error}`);
        log(`Error in listTagsHandler: ${error}`);
    }
}

export function deactivate() {
    log('Deactivating Claude Task Master extension.');
    
    // Dispose of status bar
    if (tagStatusBar) {
        tagStatusBar.dispose();
    }
    
    disposeLogger();
} 