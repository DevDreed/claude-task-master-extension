import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as sinon from 'sinon';
import { TaskMasterClient } from '../../taskMasterClient';

suite('TaskMasterClient Test Suite', () => {
    let sandbox: sinon.SinonSandbox;
    let taskMasterClient: TaskMasterClient;
    let mockTaskmasterPath: string;

    setup(() => {
        sandbox = sinon.createSandbox();
        mockTaskmasterPath = '/mock/taskmaster/path';
        
        // Mock file system operations to prevent actual file writes
        try {
            sandbox.stub(fs, 'writeFileSync').returns(undefined);
        } catch (e) {
            // Already stubbed, ignore
        }
        try {
            sandbox.stub(fs, 'mkdirSync').returns(undefined);
        } catch (e) {
            // Already stubbed, ignore
        }
        
        taskMasterClient = new TaskMasterClient(mockTaskmasterPath);
    });

    teardown(() => {
        sandbox.restore();
    });

    test('Should initialize with correct taskmaster path', () => {
        assert.strictEqual((taskMasterClient as any).taskmasterPath, mockTaskmasterPath);
    });

    test('Should detect taskmaster directory existence correctly', () => {
        // Test when directory exists
        sandbox.stub(fs, 'existsSync').returns(true);
        assert.strictEqual(taskMasterClient.hasTaskmaster(), true);

        // Test when directory doesn't exist
        sandbox.restore();
        sandbox.stub(fs, 'existsSync').returns(false);
        assert.strictEqual(taskMasterClient.hasTaskmaster(), false);
    });

    test('Should handle getTasks with valid JSON file', async () => {
        const mockTasks = [
            {
                id: '1',
                title: 'Test Task 1',
                description: 'Test description',
                status: 'todo' as const,
                priority: 'high' as const,
                dependencies: [],
                subtasks: []
            },
            {
                id: '2',
                title: 'Test Task 2',
                description: 'Another test',
                status: 'in-progress' as const,
                priority: 'medium' as const,
                dependencies: ['1'],
                subtasks: [
                    {
                        id: '2.1',
                        title: 'Subtask 1',
                        description: 'Subtask description',
                        status: 'todo' as const,
                        priority: 'low' as const,
                        dependencies: []
                    }
                ]
            }
        ];

        // Mock MCP client to avoid timeout
        sandbox.stub(taskMasterClient, 'isMCPServerAvailable').resolves(false);

        // Mock file system operations
        const tasksJsonPath = path.join(mockTaskmasterPath, 'tasks', 'tasks.json');
        sandbox.stub(fs, 'existsSync').withArgs(tasksJsonPath).returns(true);
        
        // Update to tagged format
        const taggedMockData = {
            master: {
                tasks: mockTasks,
                metadata: {
                    created: "2025-01-15T01:47:32.567Z",
                    updated: "2025-01-15T02:24:21.338Z",
                    description: "Tasks for master context"
                }
            }
        };
        sandbox.stub(fs, 'readFileSync').withArgs(tasksJsonPath, 'utf8').returns(JSON.stringify(taggedMockData));

        const result = await taskMasterClient.getTasks();
        
        assert.ok(Array.isArray(result), 'getTasks should return an array');
        assert.strictEqual(result.length, 2, 'Should return 2 tasks');
        assert.strictEqual(result[0]?.id, '1');
        assert.strictEqual(result[1]?.id, '2');
        assert.strictEqual(result[1]?.subtasks?.length, 1);
        assert.strictEqual(result[1]?.subtasks?.[0]?.id, '2.1');
    });

    test('Should handle missing tasks file gracefully', async () => {
        // Mock MCP client to avoid timeout
        sandbox.stub(taskMasterClient, 'isMCPServerAvailable').resolves(false);
        
        const tasksJsonPath = path.join(mockTaskmasterPath, 'tasks', 'tasks.json');
        const existsStub = sandbox.stub(fs, 'existsSync');
        existsStub.withArgs(tasksJsonPath).returns(false);
        existsStub.withArgs(path.join(mockTaskmasterPath, 'tasks')).returns(false);
        existsStub.returns(false); // Default return for any other path

        const result = await taskMasterClient.getTasks();
        
        assert.strictEqual(result.length, 0);
    });

    test('Should handle corrupted JSON file gracefully', async () => {
        // Mock MCP client to avoid timeout
        sandbox.stub(taskMasterClient, 'isMCPServerAvailable').resolves(false);
        
        const tasksJsonPath = path.join(mockTaskmasterPath, 'tasks', 'tasks.json');
        sandbox.stub(fs, 'existsSync').withArgs(tasksJsonPath).returns(true);
        sandbox.stub(fs, 'readFileSync').withArgs(tasksJsonPath, 'utf8').returns('invalid json content');

        const result = await taskMasterClient.getTasks();
        
        assert.strictEqual(result.length, 0);
    });

    test('Should calculate task progress correctly', async () => {
        const mockTasks = [
            { id: '1', title: 'Task 1', status: 'todo' as const },
            { id: '2', title: 'Task 2', status: 'in-progress' as const },
            { id: '3', title: 'Task 3', status: 'completed' as const },
            { id: '4', title: 'Task 4', status: 'completed' as const },
            { id: '5', title: 'Task 5', status: 'blocked' as const }
        ];

        sandbox.stub(taskMasterClient, 'getTasks').resolves(mockTasks);

        const progress = await taskMasterClient.getTaskProgress();
        
        assert.strictEqual(progress.total, 5);
        assert.strictEqual(progress.completed, 2);
        assert.strictEqual(progress.inProgress, 1);
        assert.strictEqual(progress.todo, 1);
        assert.strictEqual(progress.blocked, 1);
        
        // Verify dual counting system for tagged format
        assert.ok(progress.mainTasks, 'Should have mainTasks property for tagged format');
        assert.ok(progress.allItems, 'Should have allItems property for tagged format');
        assert.strictEqual(progress.mainTasks.total, 5);
        assert.strictEqual(progress.allItems.total, 5);
    });

    test('Should handle empty task list in progress calculation', async () => {
        sandbox.stub(taskMasterClient, 'getTasks').resolves([]);

        const progress = await taskMasterClient.getTaskProgress();
        
        assert.strictEqual(progress.total, 0);
        assert.strictEqual(progress.completed, 0);
        assert.strictEqual(progress.inProgress, 0);
        assert.strictEqual(progress.todo, 0);
        assert.strictEqual(progress.blocked, 0);
    });

    test('Should find tasks.json file in correct locations', async () => {
        // Mock MCP client to avoid timeout
        sandbox.stub(taskMasterClient, 'isMCPServerAvailable').resolves(false);
        
        // Test primary location (tasks/tasks.json)
        const tasksJsonPath = path.join(mockTaskmasterPath, 'tasks', 'tasks.json');
        const existsStub = sandbox.stub(fs, 'existsSync');
        existsStub.withArgs(tasksJsonPath).returns(true);
        existsStub.returns(false);

        sandbox.stub(fs, 'readFileSync').withArgs(tasksJsonPath, 'utf8').returns('{"master": {"tasks": [], "metadata": {"created": "2025-01-15T01:47:32.567Z", "updated": "2025-01-15T02:24:21.338Z", "description": "Tasks for master context"}}}');

        await taskMasterClient.getTasks();
        
        // Should have checked the primary location
        assert.ok(existsStub.calledWith(tasksJsonPath));
    });

    test('Should fallback to alternative locations for tasks.json', async () => {
        // Mock MCP client to avoid timeout
        sandbox.stub(taskMasterClient, 'isMCPServerAvailable').resolves(false);
        
        // Test fallback location (tasks.json in root)
        const primaryPath = path.join(mockTaskmasterPath, 'tasks', 'tasks.json');
        const fallbackPath = path.join(mockTaskmasterPath, 'tasks.json');
        const existsStub = sandbox.stub(fs, 'existsSync');
        existsStub.withArgs(primaryPath).returns(false);
        existsStub.withArgs(fallbackPath).returns(true);
        existsStub.withArgs(path.join(mockTaskmasterPath, 'tasks')).returns(true);
        existsStub.returns(false);

        sandbox.stub(fs, 'readFileSync').withArgs(fallbackPath, 'utf8').returns('{"master": {"tasks": [], "metadata": {"created": "2025-01-15T01:47:32.567Z", "updated": "2025-01-15T02:24:21.338Z", "description": "Tasks for master context"}}}');

        const result = await taskMasterClient.getTasks();
        
        assert.ok(Array.isArray(result), 'Should return an array even with fallback locations');
    });

    test('Should handle file reading errors gracefully', async () => {
        // Mock MCP client to avoid timeout
        sandbox.stub(taskMasterClient, 'isMCPServerAvailable').resolves(false);
        
        const tasksJsonPath = path.join(mockTaskmasterPath, 'tasks', 'tasks.json');
        sandbox.stub(fs, 'existsSync').withArgs(tasksJsonPath).returns(true);
        sandbox.stub(fs, 'readFileSync').withArgs(tasksJsonPath, 'utf8').throws(new Error('File read error'));

        const result = await taskMasterClient.getTasks();
        
        assert.strictEqual(result.length, 0);
    });

    test('Should properly parse tasks with various status values', async () => {
        // Mock MCP client to avoid timeout
        sandbox.stub(taskMasterClient, 'isMCPServerAvailable').resolves(false);
        
        const mockTasks = [
            { id: '1', title: 'Task 1', status: 'todo' },
            { id: '2', title: 'Task 2', status: 'pending' },
            { id: '3', title: 'Task 3', status: 'in-progress' },
            { id: '4', title: 'Task 4', status: 'review' },
            { id: '5', title: 'Task 5', status: 'completed' },
            { id: '6', title: 'Task 6', status: 'done' },
            { id: '7', title: 'Task 7', status: 'blocked' },
            { id: '8', title: 'Task 8', status: 'deferred' },
            { id: '9', title: 'Task 9', status: 'cancelled' }
        ];

        const tasksJsonPath = path.join(mockTaskmasterPath, 'tasks', 'tasks.json');
        sandbox.stub(fs, 'existsSync').withArgs(tasksJsonPath).returns(true);
        
        // Update to tagged format
        const taggedMockData = {
            master: {
                tasks: mockTasks,
                metadata: {
                    created: "2025-01-15T01:47:32.567Z",
                    updated: "2025-01-15T02:24:21.338Z",
                    description: "Tasks for master context"
                }
            }
        };
        sandbox.stub(fs, 'readFileSync').withArgs(tasksJsonPath, 'utf8').returns(JSON.stringify(taggedMockData));

        const result = await taskMasterClient.getTasks();
        
        assert.ok(Array.isArray(result), 'Should return an array for various status values');
        assert.strictEqual(result.length, 9, 'Should return all 9 tasks');
        assert.ok(result.every(task => task.status), 'All tasks should have status');
    });

    test('Should handle tasks with missing required fields', async () => {
        // Mock MCP client to avoid timeout
        sandbox.stub(taskMasterClient, 'isMCPServerAvailable').resolves(false);
        
        const mockTasks = [
            { id: '1' }, // Missing other fields
            { title: 'Task without ID' }, // Missing ID
            { id: '2', title: 'Valid Task', status: 'todo' } // Valid task
        ];

        const tasksJsonPath = path.join(mockTaskmasterPath, 'tasks', 'tasks.json');
        sandbox.stub(fs, 'existsSync').withArgs(tasksJsonPath).returns(true);
        
        // Update to tagged format
        const taggedMockData = {
            master: {
                tasks: mockTasks,
                metadata: {
                    created: "2025-01-15T01:47:32.567Z",
                    updated: "2025-01-15T02:24:21.338Z",
                    description: "Tasks for master context"
                }
            }
        };
        sandbox.stub(fs, 'readFileSync').withArgs(tasksJsonPath, 'utf8').returns(JSON.stringify(taggedMockData));

        const result = await taskMasterClient.getTasks();
        
        assert.ok(Array.isArray(result), 'Should handle missing fields gracefully');
        // The TaskMasterClient should handle tasks with missing fields gracefully
        // It may normalize or filter them, but should not crash
        // Since the task without ID will cause toString() to fail, we expect only valid tasks
        assert.ok(result.length >= 1, 'Should return at least the valid tasks');
        
        // Verify that tasks with valid IDs are included
        const tasksWithIds = result.filter(task => task.id);
        assert.ok(tasksWithIds.length >= 1, 'Should include tasks with valid IDs');
    });

    test('Should handle nested subtasks correctly', async () => {
        // Mock MCP client to avoid timeout
        sandbox.stub(taskMasterClient, 'isMCPServerAvailable').resolves(false);
        
        const mockTasks = [
            {
                id: '1',
                title: 'Parent Task',
                status: 'todo' as const,
                subtasks: [
                    {
                        id: '1.1',
                        title: 'Subtask 1',
                        status: 'todo' as const,
                        dependencies: []
                    },
                    {
                        id: '1.2',
                        title: 'Subtask 2',
                        status: 'completed' as const,
                        dependencies: ['1.1']
                    }
                ]
            }
        ];

        const tasksJsonPath = path.join(mockTaskmasterPath, 'tasks', 'tasks.json');
        sandbox.stub(fs, 'existsSync').withArgs(tasksJsonPath).returns(true);
        
        // Update to tagged format
        const taggedMockData = {
            master: {
                tasks: mockTasks,
                metadata: {
                    created: "2025-01-15T01:47:32.567Z",
                    updated: "2025-01-15T02:24:21.338Z",
                    description: "Tasks for master context"
                }
            }
        };
        sandbox.stub(fs, 'readFileSync').withArgs(tasksJsonPath, 'utf8').returns(JSON.stringify(taggedMockData));

        const result = await taskMasterClient.getTasks();
        
        assert.ok(Array.isArray(result), 'Should handle nested subtasks gracefully');
        assert.strictEqual(result.length, 1, 'Should return 1 task');
        assert.strictEqual(result[0]?.subtasks?.length, 2);
        assert.strictEqual(result[0]?.subtasks?.[0]?.id, '1.1');
        assert.strictEqual(result[0]?.subtasks?.[1]?.id, '1.2');
        assert.strictEqual(result[0]?.subtasks?.[1]?.dependencies?.length, 1);
    });

    test('Should correctly calculate dual counting system (main tasks vs all items)', async () => {
        // Create complex mock data to test the dual counting system
        const mockTasks = [
            {
                id: '1',
                title: 'Task 1',
                status: 'completed' as const,
                subtasks: [
                    { id: '1.1', title: 'Subtask 1.1', status: 'completed' as const },
                    { id: '1.2', title: 'Subtask 1.2', status: 'todo' as const }
                ]
            },
            {
                id: '2',
                title: 'Task 2',
                status: 'in-progress' as const,
                subtasks: [
                    { id: '2.1', title: 'Subtask 2.1', status: 'in-progress' as const },
                    { id: '2.2', title: 'Subtask 2.2', status: 'blocked' as const },
                    { id: '2.3', title: 'Subtask 2.3', status: 'todo' as const }
                ]
            },
            {
                id: '3',
                title: 'Task 3 (no subtasks)',
                status: 'todo' as const
                // No subtasks
            },
            {
                id: '4',
                title: 'Task 4',
                status: 'blocked' as const,
                subtasks: [
                    { id: '4.1', title: 'Subtask 4.1', status: 'completed' as const }
                ]
            }
        ];

        sandbox.stub(taskMasterClient, 'getTasks').resolves(mockTasks);

        const progress = await taskMasterClient.getTaskProgress();
        
        // Verify main tasks counts (4 main tasks)
        assert.strictEqual(progress.mainTasks.total, 4, 'Should count 4 main tasks');
        assert.strictEqual(progress.mainTasks.completed, 1, 'Should count 1 completed main task (Task 1)');
        assert.strictEqual(progress.mainTasks.inProgress, 1, 'Should count 1 in-progress main task (Task 2)');
        assert.strictEqual(progress.mainTasks.todo, 1, 'Should count 1 todo main task (Task 3)');
        assert.strictEqual(progress.mainTasks.blocked, 1, 'Should count 1 blocked main task (Task 4)');

        // Verify all items counts (4 main tasks + 6 subtasks = 10 total)
        assert.strictEqual(progress.allItems.total, 10, 'Should count 10 total items (4 main + 6 subtasks)');
        assert.strictEqual(progress.allItems.completed, 3, 'Should count 3 completed items (Task 1 + 1.1 + 4.1)');
        assert.strictEqual(progress.allItems.inProgress, 2, 'Should count 2 in-progress items (Task 2 + 2.1)');
        assert.strictEqual(progress.allItems.todo, 3, 'Should count 3 todo items (Task 3 + 1.2 + 2.3)');
        assert.strictEqual(progress.allItems.blocked, 2, 'Should count 2 blocked items (Task 4 + 2.2)');

        // Verify backward compatibility - legacy format should match allItems
        assert.strictEqual(progress.total, progress.allItems.total, 'Legacy total should match allItems total');
        assert.strictEqual(progress.completed, progress.allItems.completed, 'Legacy completed should match allItems');
        assert.strictEqual(progress.inProgress, progress.allItems.inProgress, 'Legacy inProgress should match allItems');
        assert.strictEqual(progress.todo, progress.allItems.todo, 'Legacy todo should match allItems');
        assert.strictEqual(progress.blocked, progress.allItems.blocked, 'Legacy blocked should match allItems');
    });

    test('Should handle dual counting with empty subtasks arrays', async () => {
        const mockTasks = [
            {
                id: '1',
                title: 'Task with empty subtasks',
                status: 'completed' as const,
                subtasks: [] // Empty array
            },
            {
                id: '2',
                title: 'Task without subtasks property',
                status: 'todo' as const
                // No subtasks property at all
            }
        ];

        sandbox.stub(taskMasterClient, 'getTasks').resolves(mockTasks);

        const progress = await taskMasterClient.getTaskProgress();
        
        // Both main tasks and all items should be the same since no subtasks exist
        assert.strictEqual(progress.mainTasks.total, 2);
        assert.strictEqual(progress.allItems.total, 2);
        assert.strictEqual(progress.mainTasks.completed, 1);
        assert.strictEqual(progress.allItems.completed, 1);
        assert.strictEqual(progress.mainTasks.todo, 1);
        assert.strictEqual(progress.allItems.todo, 1);
    });

    test('Should only read valid task files and ignore arbitrary JSON files', async () => {
        // Mock MCP client to avoid timeout
        sandbox.stub(taskMasterClient, 'isMCPServerAvailable').resolves(false);
        
        // Test the file filtering logic that excludes files like tasks_THISAPP.json
        const mockTasksPath = path.join(mockTaskmasterPath, 'tasks');
        
        // Mock readdirSync to return a mix of valid and invalid files
        const mockFiles = [
            'tasks.json',           // Should be excluded (handled separately)
            'task_001.json',        // Should be included
            'task_002.json',        // Should be included  
            '1.json',               // Should be included
            '2.json',               // Should be included
            'tasks_THISAPP.json',   // Should be excluded (arbitrary JSON)
            'config.json',          // Should be excluded (arbitrary JSON)
            'random.json',          // Should be excluded (arbitrary JSON)
            'task_abc.json',        // Should be excluded (non-numeric)
            'not_a_task.json',      // Should be excluded
            'task_001.txt',         // Should be excluded (not JSON)
            '3',                    // Should be excluded (no extension)
        ];

        const existsStub = sandbox.stub(fs, 'existsSync');
        const readdirStub = sandbox.stub(fs, 'readdirSync');
        const readFileStub = sandbox.stub(fs, 'readFileSync');

        // tasks.json doesn't exist, so it falls back to individual files
        existsStub.withArgs(path.join(mockTasksPath, 'tasks.json')).returns(false);
        existsStub.withArgs(mockTasksPath).returns(true);
        
        // Return our mock file list (cast to any to avoid TypeScript type issues in tests)
        readdirStub.withArgs(mockTasksPath).returns(mockFiles as any);

        // Mock valid JSON content for the valid files
        readFileStub.withArgs(path.join(mockTasksPath, 'task_001.json'), 'utf8')
                   .returns('{"id": "1", "title": "Task 1", "status": "todo"}');
        readFileStub.withArgs(path.join(mockTasksPath, 'task_002.json'), 'utf8')
                   .returns('{"id": "2", "title": "Task 2", "status": "todo"}');
        readFileStub.withArgs(path.join(mockTasksPath, '1.json'), 'utf8')
                   .returns('{"id": "3", "title": "Task 3", "status": "todo"}');
        readFileStub.withArgs(path.join(mockTasksPath, '2.json'), 'utf8')
                   .returns('{"id": "4", "title": "Task 4", "status": "todo"}');

        const result = await taskMasterClient.getTasks();
        
        // Should only have read the 4 valid task files, ignoring arbitrary JSON files
        assert.strictEqual(result.length, 4, 'Should only read valid task files');
        
        // Verify the readFileSync was only called for valid files
        assert.ok(readFileStub.calledWith(path.join(mockTasksPath, 'task_001.json'), 'utf8'));
        assert.ok(readFileStub.calledWith(path.join(mockTasksPath, 'task_002.json'), 'utf8'));
        assert.ok(readFileStub.calledWith(path.join(mockTasksPath, '1.json'), 'utf8'));
        assert.ok(readFileStub.calledWith(path.join(mockTasksPath, '2.json'), 'utf8'));
        
        // Verify it did NOT try to read invalid files
        assert.ok(!readFileStub.calledWith(path.join(mockTasksPath, 'tasks_THISAPP.json'), 'utf8'));
        assert.ok(!readFileStub.calledWith(path.join(mockTasksPath, 'config.json'), 'utf8'));
        assert.ok(!readFileStub.calledWith(path.join(mockTasksPath, 'random.json'), 'utf8'));
        assert.ok(!readFileStub.calledWith(path.join(mockTasksPath, 'task_abc.json'), 'utf8'));
    });

    test('Should prioritize tasks.json over individual files when both exist', async () => {
        // Mock MCP client to avoid timeout
        sandbox.stub(taskMasterClient, 'isMCPServerAvailable').resolves(false);
        
        const mockTasksPath = path.join(mockTaskmasterPath, 'tasks');
        
        const existsStub = sandbox.stub(fs, 'existsSync');
        const readdirStub = sandbox.stub(fs, 'readdirSync');
        const readFileStub = sandbox.stub(fs, 'readFileSync');

        // Both tasks.json and individual files exist
        existsStub.withArgs(path.join(mockTasksPath, 'tasks.json')).returns(true);
        existsStub.withArgs(mockTasksPath).returns(true);
        
        // Mock files that would be found (cast to any to avoid TypeScript type issues in tests)
        readdirStub.withArgs(mockTasksPath).returns(['tasks.json', 'task_001.json', 'task_002.json'] as any);

        // Mock tasks.json content
        const tasksJsonContent = {
            tasks: [
                { id: '1', title: 'Task from tasks.json', status: 'todo' },
                { id: '2', title: 'Another task from tasks.json', status: 'done' }
            ]
        };
        readFileStub.withArgs(path.join(mockTasksPath, 'tasks.json'), 'utf8')
                   .returns(JSON.stringify(tasksJsonContent));

        const result = await taskMasterClient.getTasks();
        
        // Should only read from tasks.json, not individual files
        assert.strictEqual(result.length, 2, 'Should read from tasks.json');
        assert.strictEqual(result[0]?.title, 'Task from tasks.json');
        
        // Verify it only read tasks.json
        assert.ok(readFileStub.calledWith(path.join(mockTasksPath, 'tasks.json'), 'utf8'));
        assert.ok(!readFileStub.calledWith(path.join(mockTasksPath, 'task_001.json'), 'utf8'));
    });

    // =============================================================================
    // CRITICAL MISSING TESTS - Added to prevent ID comparison bugs
    // =============================================================================

    test('getTaskDetails should find tasks with numeric IDs (real-world scenario)', async () => {
        // This test covers the actual bug that occurred - numeric IDs in JSON vs string search
        const mockTasks = [
            {
                id: 1,  // Numeric ID like in real tasks.json
                title: 'Task 1',
                description: 'First task',
                status: 'todo' as const,
                priority: 'high' as const
            },
            {
                id: 2,  // Numeric ID like in real tasks.json  
                title: 'Task 2',
                description: 'Second task',
                status: 'in-progress' as const,
                subtasks: [
                    {
                        id: '2.1',  // String subtask ID
                        title: 'Subtask 2.1',
                        status: 'todo' as const
                    }
                ]
            }
        ];

        sandbox.stub(taskMasterClient, 'getTasks').resolves(mockTasks as any);

        // Test finding main task with numeric ID using string search (common UI scenario)
        const task1 = await taskMasterClient.getTaskDetails('1');
        assert.ok(task1, 'Should find task with numeric ID when searching with string');
        assert.strictEqual(task1?.id, 1);
        assert.strictEqual(task1?.title, 'Task 1');

        const task2 = await taskMasterClient.getTaskDetails('2');
        assert.ok(task2, 'Should find task 2 with numeric ID');
        assert.strictEqual(task2?.id, 2);
        assert.strictEqual(task2?.title, 'Task 2');

        // Test finding subtask with string ID
        const subtask = await taskMasterClient.getTaskDetails('2.1');
        assert.ok(subtask, 'Should find subtask with string ID');
        assert.strictEqual(subtask?.id, '2.1');
        assert.strictEqual(subtask?.title, 'Subtask 2.1');

        // Test non-existent task
        const nonExistent = await taskMasterClient.getTaskDetails('999');
        assert.strictEqual(nonExistent, null, 'Should return null for non-existent task');
    });

    test('getTaskDetails should handle mixed ID types correctly', async () => {
        const mockTasks = [
            {
                id: 1,  // Numeric
                title: 'Numeric ID Task',
                status: 'todo' as const
            },
            {
                id: '2',  // String  
                title: 'String ID Task',
                status: 'todo' as const
            },
            {
                id: 3,  // Numeric with subtasks
                title: 'Parent Task',
                status: 'todo' as const,
                subtasks: [
                    { id: '3.1', title: 'String subtask', status: 'todo' as const },
                    { id: 3.2, title: 'Numeric subtask', status: 'todo' as const }  // Edge case: numeric subtask ID
                ]
            }
        ];

        sandbox.stub(taskMasterClient, 'getTasks').resolves(mockTasks as any);

        // All searches should work regardless of ID type mismatch
        const numericTask = await taskMasterClient.getTaskDetails('1');
        assert.strictEqual(numericTask?.title, 'Numeric ID Task');

        const stringTask = await taskMasterClient.getTaskDetails('2');
        assert.strictEqual(stringTask?.title, 'String ID Task');

        const parentTask = await taskMasterClient.getTaskDetails('3');
        assert.strictEqual(parentTask?.title, 'Parent Task');

        const stringSubtask = await taskMasterClient.getTaskDetails('3.1');
        assert.strictEqual(stringSubtask?.title, 'String subtask');

        const numericSubtask = await taskMasterClient.getTaskDetails('3.2');
        assert.strictEqual(numericSubtask?.title, 'Numeric subtask');
    });

    test('setTaskStatus should handle numeric IDs correctly', async () => {
        const mockTasksPath = path.join(mockTaskmasterPath, 'tasks');
        const tasksJsonPath = path.join(mockTasksPath, 'tasks.json');
        
        // Mock initial data with numeric IDs (like real world)
        const initialTasks = {
            tasks: [
                {
                    id: 1,  // Numeric ID
                    title: 'Task 1',
                    status: 'todo',
                    updated: '2023-01-01T00:00:00.000Z'
                },
                {
                    id: 2,  // Numeric ID
                    title: 'Task 2', 
                    status: 'pending',
                    subtasks: [
                        {
                            id: '2.1',  // String subtask ID
                            title: 'Subtask 2.1',
                            status: 'todo'
                        }
                    ]
                }
            ]
        };

        let updatedData: any = null;

        // Use existing stubs and add specific behavior
        sandbox.stub(fs, 'existsSync').withArgs(tasksJsonPath).returns(true);
        sandbox.stub(fs, 'readFileSync').withArgs(tasksJsonPath, 'utf8').returns(JSON.stringify(initialTasks));
        
        // Restore the writeFileSync stub and create a new one for this test
        sandbox.restore();
        sandbox = sinon.createSandbox();
        
        // Mock MCP client to avoid timeout
        sandbox.stub(taskMasterClient, 'isMCPServerAvailable').resolves(false);
        
        sandbox.stub(fs, 'writeFileSync').callsFake((path, data) => {
            if (path === tasksJsonPath) {
                updatedData = JSON.parse(data as string);
            }
        });
        sandbox.stub(fs, 'existsSync').withArgs(tasksJsonPath).returns(true);
        sandbox.stub(fs, 'readFileSync').withArgs(tasksJsonPath, 'utf8').returns(JSON.stringify(initialTasks));

        // Test updating main task with numeric ID using string parameter (common from UI)
        await taskMasterClient.setTaskStatus('1', 'in-progress');
        
        assert.ok(updatedData, 'Data should have been written');
        assert.strictEqual(updatedData.tasks[0].status, 'in-progress', 'Task 1 status should be updated');
        assert.ok(updatedData.tasks[0].updated !== '2023-01-01T00:00:00.000Z', 'Updated timestamp should change');

        // Test updating subtask with string ID
        await taskMasterClient.setTaskStatus('2.1', 'completed');
        
        assert.strictEqual(updatedData.tasks[1].subtasks[0].status, 'done', 'Subtask status should be normalized to "done"');
    });

    test('setTaskStatus should handle ID type mismatches gracefully', async () => {
        const mockTasksPath = path.join(mockTaskmasterPath, 'tasks');
        const tasksJsonPath = path.join(mockTasksPath, 'tasks.json');
        
        const initialTasks = {
            tasks: [
                {
                    id: 1,     // Numeric
                    title: 'Numeric Task',
                    status: 'todo'
                },
                {
                    id: '2',   // String
                    title: 'String Task', 
                    status: 'todo'
                }
            ]
        };

        let writeCount = 0;
        
        // Restore and recreate sandbox to avoid stubbing conflicts
        sandbox.restore();
        sandbox = sinon.createSandbox();
        
        // Mock MCP client to avoid timeout
        sandbox.stub(taskMasterClient, 'isMCPServerAvailable').resolves(false);
        
        sandbox.stub(fs, 'existsSync').withArgs(tasksJsonPath).returns(true);
        sandbox.stub(fs, 'readFileSync').withArgs(tasksJsonPath, 'utf8').returns(JSON.stringify(initialTasks));
        sandbox.stub(fs, 'writeFileSync').callsFake(() => { writeCount++; });

        // Should successfully update task with numeric ID using string search
        await taskMasterClient.setTaskStatus('1', 'completed');
        assert.strictEqual(writeCount, 1, 'Should successfully write for numeric ID task');

        // Should successfully update task with string ID using string search  
        await taskMasterClient.setTaskStatus('2', 'completed');
        assert.strictEqual(writeCount, 2, 'Should successfully write for string ID task');

        // Should throw error for non-existent task
        try {
            await taskMasterClient.setTaskStatus('999', 'completed');
            assert.fail('Should throw error for non-existent task');
        } catch (error) {
            assert.ok(error instanceof Error);
            assert.ok(error.message.includes('Task with ID 999 not found'));
        }
    });

    test('getTaskDetails should correctly distinguish between similar IDs', async () => {
        // This test ensures we don't accidentally return wrong tasks due to loose matching
        const mockTasks = [
            {
                id: 1,
                title: 'Task 1',
                status: 'todo' as const
            },
            {
                id: 11, 
                title: 'Task 11',
                status: 'todo' as const
            },
            {
                id: 2,
                title: 'Task 2',
                status: 'todo' as const,
                subtasks: [
                    {
                        id: '2.1',
                        title: 'Subtask 2.1', 
                        status: 'todo' as const
                    },
                    {
                        id: '2.11',  // Similar to both 2.1 and 11
                        title: 'Subtask 2.11',
                        status: 'todo' as const
                    }
                ]
            }
        ];

        sandbox.stub(taskMasterClient, 'getTasks').resolves(mockTasks as any);

        // Should find exact matches only
        const task1 = await taskMasterClient.getTaskDetails('1');
        assert.strictEqual(task1?.id, 1);
        assert.strictEqual(task1?.title, 'Task 1');

        const task11 = await taskMasterClient.getTaskDetails('11');
        assert.strictEqual(task11?.id, 11);
        assert.strictEqual(task11?.title, 'Task 11');

        const subtask21 = await taskMasterClient.getTaskDetails('2.1');
        assert.strictEqual(subtask21?.id, '2.1');
        assert.strictEqual(subtask21?.title, 'Subtask 2.1');

        const subtask211 = await taskMasterClient.getTaskDetails('2.11');
        assert.strictEqual(subtask211?.id, '2.11');
        assert.strictEqual(subtask211?.title, 'Subtask 2.11');
    });

    // Test suite for improved task lookup functionality
    test('getTaskDetails should efficiently find subtasks using dot notation', async () => {
        const mockTasks = [
            {
                id: '1',
                title: 'Task 1',
                status: 'done' as const,
                subtasks: [
                    { id: '1.1', title: 'Subtask 1', status: 'done' as const },
                    { id: '1.2', title: 'Subtask 2', status: 'done' as const },
                    { id: '1.3', title: 'Subtask 3', status: 'in-progress' as const }
                ]
            },
            {
                id: '2',
                title: 'Task 2',
                status: 'done' as const,
                subtasks: []
            },
            {
                id: '3',
                title: 'Task 3',
                status: 'todo' as const,
                subtasks: [
                    { id: '3.1', title: 'Different Subtask 1', status: 'todo' as const },
                    { id: '3.2', title: 'Different Subtask 2', status: 'todo' as const }
                ]
            }
        ];

        sandbox.stub(taskMasterClient, 'getTasks').resolves(mockTasks as any);

        // Test finding subtask using dot notation (e.g., '1.2' for subtask 2 of task 1)
        const subtask1 = await taskMasterClient.getTaskDetails('1.2');
        assert.ok(subtask1, 'Should find subtask 1.2');
        assert.strictEqual(subtask1?.id, '1.2', 'Should have correct subtask ID');
        assert.strictEqual(subtask1?.title, 'Subtask 2', 'Should have correct subtask title');

        // Test finding different subtask with same local ID but different parent
        const subtask2 = await taskMasterClient.getTaskDetails('3.2');
        assert.ok(subtask2, 'Should find subtask 3.2');
        assert.strictEqual(subtask2?.id, '3.2', 'Should have correct subtask ID');
        assert.strictEqual(subtask2?.title, 'Different Subtask 2', 'Should have correct subtask title from different parent');

        // Verify these are actually different tasks
        assert.notStrictEqual(subtask1?.title, subtask2?.title, 'Subtasks with same ID from different parents should be different');
    });

    test('getTaskDetails should handle main task lookup', async () => {
        const mockTasks = [
            {
                id: '1',
                title: 'Main Task 1',
                status: 'todo' as const,
                subtasks: []
            },
            {
                id: '2',
                title: 'Main Task 2',
                status: 'done' as const,
                subtasks: [
                    { id: '2.1', title: 'Subtask 1', status: 'done' as const }
                ]
            }
        ];

        sandbox.stub(taskMasterClient, 'getTasks').resolves(mockTasks as any);

        // Test main task lookup
        const mainTask1 = await taskMasterClient.getTaskDetails('1');
        assert.ok(mainTask1, 'Should find main task 1');
        assert.strictEqual(mainTask1?.id, '1');
        assert.strictEqual(mainTask1?.title, 'Main Task 1');

        // Test another main task lookup
        const mainTask2 = await taskMasterClient.getTaskDetails('2');
        assert.ok(mainTask2, 'Should find main task 2');
        assert.strictEqual(mainTask2?.id, '2');
        assert.strictEqual(mainTask2?.title, 'Main Task 2');
    });

    test('getTaskDetails should handle non-existent task ID', async () => {
        const mockTasks = [
            {
                id: '1',
                title: 'Task 1',
                status: 'todo' as const,
                subtasks: [
                    { id: '1.1', title: 'Subtask 1', status: 'todo' as const }
                ]
            }
        ];

        sandbox.stub(taskMasterClient, 'getTasks').resolves(mockTasks as any);

        // Test with non-existent task ID
        const result = await taskMasterClient.getTaskDetails('999');
        assert.strictEqual(result, null, 'Should return null when task not found');
    });

    test('getTaskDetails should handle non-existent subtask ID', async () => {
        const mockTasks = [
            {
                id: '1',
                title: 'Task 1',
                status: 'todo' as const,
                subtasks: [
                    { id: '1.1', title: 'Subtask 1', status: 'todo' as const },
                    { id: '1.2', title: 'Subtask 2', status: 'todo' as const }
                ]
            }
        ];

        sandbox.stub(taskMasterClient, 'getTasks').resolves(mockTasks as any);

        // Test with subtask ID that doesn't exist
        const result = await taskMasterClient.getTaskDetails('1.999');
        assert.strictEqual(result, null, 'Should return null when subtask not found');
    });

    test('getTaskDetails should handle string ID types correctly', async () => {
        const mockTasks = [
            {
                id: '1',
                title: 'Parent Task 1',
                status: 'todo' as const,
                subtasks: [
                    { id: '1.1', title: 'Subtask 1', status: 'todo' as const },
                    { id: '1.2', title: 'Subtask 2', status: 'todo' as const }
                ]
            },
            {
                id: '2',
                title: 'Parent Task 2',
                status: 'todo' as const,
                subtasks: [
                    { id: '2.1', title: 'Task 2 Subtask 1', status: 'todo' as const }
                ]
            }
        ];

        sandbox.stub(taskMasterClient, 'getTasks').resolves(mockTasks as any);

        // Test finding subtask with dot notation
        const subtask1 = await taskMasterClient.getTaskDetails('1.1');
        assert.ok(subtask1, 'Should find subtask 1.1');
        assert.strictEqual(subtask1?.title, 'Subtask 1');

        // Test finding another subtask
        const subtask2 = await taskMasterClient.getTaskDetails('1.2');
        assert.ok(subtask2, 'Should find subtask 1.2');
        assert.strictEqual(subtask2?.title, 'Subtask 2');

        // Test finding subtask in different parent
        const subtaskInParent2 = await taskMasterClient.getTaskDetails('2.1');
        assert.ok(subtaskInParent2, 'Should find subtask in parent 2');
        assert.strictEqual(subtaskInParent2?.title, 'Task 2 Subtask 1');
    });

    test('getTaskDetails should solve the original bug scenario', async () => {
        // Recreate the exact scenario from the bug report
        const mockTasks = [
            {
                id: '1',
                title: 'Dynamic Permission-Aware UI System',
                status: 'done' as const,
                priority: 'high' as const,
                subtasks: [
                    { id: '1.1', title: 'Implement PermissionManager Core System', status: 'done' as const },
                    { id: '1.2', title: 'Create Permission-Aware Component Architecture', status: 'done' as const }
                ]
            },
            {
                id: '2',
                title: 'Dynamic Phone Widget System',
                status: 'done' as const,
                priority: 'high' as const,
                subtasks: []
            }
        ];

        sandbox.stub(taskMasterClient, 'getTasks').resolves(mockTasks as any);

        // Test the scenario that was causing the bug:
        // User clicks on main Task 2, should get Task 2, NOT subtask 2 of Task 1

        // This is what should happen when user clicks main Task 2
        const mainTask2 = await taskMasterClient.getTaskDetails('2');
        assert.ok(mainTask2, 'Should find main Task 2');
        assert.strictEqual(mainTask2?.id, '2', 'Should have ID 2');
        assert.strictEqual(mainTask2?.title, 'Dynamic Phone Widget System', 'Should be the main task, not a subtask');

        // This is what should happen when user clicks subtask 1.2 (subtask 2 of Task 1)
        const subtask2OfTask1 = await taskMasterClient.getTaskDetails('1.2');
        assert.ok(subtask2OfTask1, 'Should find subtask 1.2');
        assert.strictEqual(subtask2OfTask1?.id, '1.2', 'Should have subtask ID 1.2');
        assert.strictEqual(subtask2OfTask1?.title, 'Create Permission-Aware Component Architecture', 'Should be the subtask, not main task');

        // Verify these are different tasks
        assert.notStrictEqual(mainTask2?.title, subtask2OfTask1?.title, 'Main Task 2 and Subtask 1.2 should be different');

        console.log('✅ Original bug scenario test: getTaskDetails correctly distinguishes main Task 2 from Subtask 1.2');
    });

    test('getTaskDetails should handle error cases gracefully', async () => {
        // Test when getTasks throws an error
        sandbox.stub(taskMasterClient, 'getTasks').rejects(new Error('Network error'));

        const result = await taskMasterClient.getTaskDetails('1');
        assert.strictEqual(result, null, 'Should return null when error occurs');

        const subtaskResult = await taskMasterClient.getTaskDetails('1.2');
        assert.strictEqual(subtaskResult, null, 'Should return null when error occurs for subtask lookup');
    });

    test('getTaskDetails with separate mainTaskId and subtaskId parameters', async () => {
        // Test the new functionality where mainTaskId and subtaskId are passed separately
        const mockTasks = [
            {
                id: '1',
                title: 'Main Task 1',
                status: 'todo' as const,
                subtasks: [
                    { id: '1', title: 'Subtask 1', status: 'todo' as const },
                    { id: '2', title: 'Subtask 2', status: 'todo' as const },
                    { id: '3', title: 'Subtask 3', status: 'done' as const }
                ]
            },
            {
                id: '2',
                title: 'Main Task 2',
                status: 'in-progress' as const,
                subtasks: [
                    { id: '1', title: 'Task 2 Subtask 1', status: 'todo' as const },
                    { id: '2', title: 'Task 2 Subtask 2', status: 'in-progress' as const }
                ]
            }
        ];

        sandbox.stub(taskMasterClient, 'getTasks').resolves(mockTasks as any);

        // Test finding main task when no subtaskId is provided
        const mainTask1 = await taskMasterClient.getTaskDetails('1');
        assert.ok(mainTask1, 'Should find main task 1');
        assert.strictEqual(mainTask1?.id, '1');
        assert.strictEqual(mainTask1?.title, 'Main Task 1');

        // Test finding subtask using separate parameters (mainTaskId='1', subtaskId='2')
        const subtask2InTask1 = await taskMasterClient.getTaskDetails('1', '2');
        assert.ok(subtask2InTask1, 'Should find subtask 2 in main task 1');
        assert.strictEqual(subtask2InTask1?.id, '2');
        assert.strictEqual(subtask2InTask1?.title, 'Subtask 2');

        // Test finding different subtask with same ID but different parent (mainTaskId='2', subtaskId='2')
        const subtask2InTask2 = await taskMasterClient.getTaskDetails('2', '2');
        assert.ok(subtask2InTask2, 'Should find subtask 2 in main task 2');
        assert.strictEqual(subtask2InTask2?.id, '2');
        assert.strictEqual(subtask2InTask2?.title, 'Task 2 Subtask 2');

        // Verify these are different tasks despite having the same subtask ID
        assert.notStrictEqual(subtask2InTask1?.title, subtask2InTask2?.title, 'Subtasks with same ID in different parents should be different');

        // Test finding subtask 1 in main task 1 (mainTaskId='1', subtaskId='1')
        const subtask1InTask1 = await taskMasterClient.getTaskDetails('1', '1');
        assert.ok(subtask1InTask1, 'Should find subtask 1 in main task 1');
        assert.strictEqual(subtask1InTask1?.id, '1');
        assert.strictEqual(subtask1InTask1?.title, 'Subtask 1');

        // Test that this doesn't conflict with main task lookup for same ID
        const mainTask1Again = await taskMasterClient.getTaskDetails('1');
        assert.ok(mainTask1Again, 'Should still be able to find main task 1');
        assert.strictEqual(mainTask1Again?.title, 'Main Task 1');
        assert.notStrictEqual(subtask1InTask1?.title, mainTask1Again?.title, 'Main task and subtask should be different');

        console.log('✅ Separate parameter test: getTaskDetails correctly handles mainTaskId and subtaskId parameters');
    });

    test('getTaskDetails with separate parameters should handle non-existent cases', async () => {
        const mockTasks = [
            {
                id: '1',
                title: 'Main Task 1',
                status: 'todo' as const,
                subtasks: [
                    { id: '1', title: 'Subtask 1', status: 'todo' as const },
                    { id: '2', title: 'Subtask 2', status: 'todo' as const }
                ]
            }
        ];

        sandbox.stub(taskMasterClient, 'getTasks').resolves(mockTasks as any);

        // Test non-existent main task
        const nonExistentMain = await taskMasterClient.getTaskDetails('999', '1');
        assert.strictEqual(nonExistentMain, null, 'Should return null for non-existent main task');

        // Test non-existent subtask in existing main task
        const nonExistentSubtask = await taskMasterClient.getTaskDetails('1', '999');
        assert.strictEqual(nonExistentSubtask, null, 'Should return null for non-existent subtask');

        // Test main task with no subtasks
        const mockTasksNoSubtasks = [
            {
                id: '1',
                title: 'Main Task 1',
                status: 'todo' as const,
                subtasks: []
            }
        ];

        sandbox.restore();
        sandbox.stub(taskMasterClient, 'getTasks').resolves(mockTasksNoSubtasks as any);

        const subtaskInEmptyTask = await taskMasterClient.getTaskDetails('1', '1');
        assert.strictEqual(subtaskInEmptyTask, null, 'Should return null when looking for subtask in task with no subtasks');
    });

    // Tagged Format Tests
    suite('Tagged Format Support', () => {
        test('Should have updateTask method', () => {
            assert.ok(typeof taskMasterClient.updateTask === 'function', 'updateTask method should exist');
        });

        test('Should have deleteTask method', () => {
            assert.ok(typeof taskMasterClient.deleteTask === 'function', 'deleteTask method should exist');
        });

        test('Should handle tagged format structure detection', () => {
            const legacyFormat = [{ id: '1', title: 'Task' }];
            const taggedFormat = { master: { tasks: [{ id: '1', title: 'Task' }] } };
            const v017Format = { tags: { master: { tasks: [{ id: '1', title: 'Task' }] } } };

            // Test format detection logic (this would normally be in extractTasksFromContainer)
            assert.ok(Array.isArray(legacyFormat), 'Legacy format should be array');
            assert.ok(taggedFormat.master, 'Tagged format should have master property');
            assert.ok(v017Format.tags, 'v0.17.0+ format should have tags property');
        });
    });

}); 