# Claude Task Master Visual Interface

[![Version](https://img.shields.io/badge/version-1.2.2-blue.svg)](https://marketplace.visualstudio.com/items?itemName=DevDreed.claude-task-master-extension)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.70.0+-orange.svg)](https://code.visualstudio.com/)
[![Tests](https://img.shields.io/badge/tests-130%20passing-brightgreen.svg)](TEST_COVERAGE.md)
[![Task Master](https://img.shields.io/badge/Task%20Master-v0.17.0%20Compatible-green.svg)](https://github.com/eyaltoledano/claude-task-master)

A VS Code/Cursor extension that provides a rich visual interface for [task-master-ai](https://github.com/eyaltoledano/claude-task-master) projects. Transform your task management workflow with intuitive tree views, progress tracking, and seamless IDE integration.

**🎯 Purpose**: This extension is designed as a **pure enhancement** to task-master-ai, providing a modern visual interface without competing with the original functionality. It requires an existing task-master-ai project and works alongside the CLI and MCP tools.

---

## ✨ Features

### 🏷️ **Multi-Context Tag Management** (v1.2.0+)

- **Tagged Task System**: Full support for Task Master v0.17.0's tagged format for multi-context project management
- **Tag Status Bar**: Real-time current tag indicator with click-to-switch functionality
- **Tag Management Commands**: Create, switch, delete, and list tags directly from VS Code command palette
- **Silent Migration**: Automatic detection and handling of legacy format upgrades with zero breaking changes
- **Context Preservation**: All operations maintain proper tag context across the entire workflow

### 🌳 **Visual Task Management**

- **Hierarchical Tree View**: See all your tasks in an organized, expandable tree structure
- **Dropdown Subtasks**: Click to expand/collapse subtasks with visual progress indicators
- **Smart Grouping**: View tasks by status (Todo, In Progress, Completed, Blocked) or priority
- **Progress Overview**: Real-time completion statistics and visual progress bars
- **Tag-Aware Display**: Visual indicators for current tag context and available tag count

### ⚡ **Robust Operation**

- **CLI Fallback System**: Automatically falls back to `task-master-ai` CLI when MCP server is unavailable
- **Real-time Updates**: Auto-refresh when task files change
- **Cross-platform**: Works on Windows, macOS, and Linux
- **Error Recovery**: Graceful handling of all error scenarios

### 🎯 **Productivity Features**

- **Context Menus**: Right-click tasks for quick actions (edit, delete, change status, add subtasks)
- **Smart Icons**: Color-coded status and priority indicators
- **Next Task Recommendations**: AI-powered suggestions for what to work on next
- **Search & Filter**: Find tasks quickly by status, priority, or content
- **Task Details**: Rich detail views with implementation notes and test strategies

### 🛠️ **Developer Experience**

- **Zero Configuration**: Works immediately in any task-master-ai project
- **Progressive Enhancement**: Basic features without MCP, advanced features with MCP
- **Comprehensive Testing**: 130 tests with 100% pass rate, including full tagged format coverage
- **Professional Documentation**: Complete setup and usage guides
- **Enhanced MCP Integration**: Real protocol communication with robust error handling and fallbacks

### 🔧 **Latest Improvements** (v1.2.2)

- **Enhanced Stability**: Improved core extension stability and connection reliability
- **MCP Client Enhancements**: Better MCP protocol communication and error recovery
- **Task Provider Optimizations**: Improved task tree rendering and state management
- **Test Suite Updates**: Enhanced test coverage and reliability with comprehensive validation
- **Development Tools**: Updated build scripts and improved development installation process

---

## 🚀 Quick Start

### Prerequisites

1. **Task Master AI**: You need [task-master-ai](https://github.com/eyaltoledano/claude-task-master) set up in your project
2. **VS Code or Cursor**: VS Code 1.70.0+ or Cursor IDE  
3. **Workspace**: The extension works only in workspace/folder contexts (not single files)

⚠️ **Important**: This extension requires an existing task-master-ai project with a `.taskmaster` directory.

### Installation

#### Option 1: From VS Code Marketplace (Recommended)

1. Open VS Code/Cursor
2. Go to Extensions (Ctrl+Shift+X)
3. Search for "Claude Task Master Visual Interface"
4. Click Install

#### Option 2: Install from VSIX

1. Download the latest `.vsix` file from [releases](https://github.com/DevDreed/claude-task-master-extension/releases)
2. Open VS Code/Cursor
3. Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (macOS)
4. Type "Extensions: Install from VSIX"
5. Select the downloaded `.vsix` file

### Platform-Specific Setup

#### macOS Setup

1. **Install VS Code/Cursor CLI tools** (required for dev-install script):

   **For VS Code:**
   ```bash
   # Option 1: Install via VS Code Command Palette
   # Open VS Code → Cmd+Shift+P → "Shell Command: Install 'code' command in PATH"
   
   # Option 2: Manual symlink
   sudo ln -s "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" /usr/local/bin/code
   ```

   **For Cursor:**
   ```bash
   # Option 1: Install via Cursor Command Palette  
   # Open Cursor → Cmd+Shift+P → "Shell Command: Install 'cursor' command in PATH"
   
   # Option 2: Manual symlink
   sudo ln -s "/Applications/Cursor.app/Contents/Resources/app/bin/cursor" /usr/local/bin/cursor
   ```

2. **Verify CLI installation**:
   ```bash
   code --version    # For VS Code
   cursor --version  # For Cursor
   ```

#### Windows Setup

The dev-install script automatically detects Windows installations. No additional setup required.

#### Linux Setup

Most package managers automatically install CLI tools. If not available:

   ```bash
# For snap installations
sudo snap alias code.code code
sudo snap alias code-insiders.code-insiders code-insiders

# Verify installation
code --version
```

### Setup

1. **Initialize Task Master AI** in your project:

   ```bash
   # Via CLI
   npx task-master-ai init
   
   # Or via Claude AI chat (if MCP is set up)
   "Initialize task-master-ai in my project"
   ```

2. **Open your project** in VS Code/Cursor

3. **Look for the Claude Task Master panel** in the sidebar - it should appear automatically if a `.taskmaster` directory is detected

---

## 🔧 Configuration

### Basic Configuration

The extension can be configured via VS Code settings:

```json
{
  "claudeTaskMaster.autoRefresh": true,
  "claudeTaskMaster.taskmasterPath": ".taskmaster",
  "claudeTaskMaster.developmentMode": false,
  "claudeTaskMaster.enableLogging": false,
  "claudeTaskMaster.enableFileLogging": false
}
```

### Settings Reference

| Setting | Default | Description |
|---------|---------|-------------|
| `claudeTaskMaster.autoRefresh` | `true` | Automatically refresh when task files change |
| `claudeTaskMaster.taskmasterPath` | `".taskmaster"` | Path to taskmaster directory (relative to workspace root) |
| `claudeTaskMaster.developmentMode` | `false` | Enable detailed logging for troubleshooting |
| `claudeTaskMaster.enableLogging` | `false` | Enable console and VS Code output channel logging |
| `claudeTaskMaster.enableFileLogging` | `false` | Enable file logging (creates logs/extension.log in your project) |

### MCP Server Configuration (Optional)

For advanced features like AI-powered task expansion, set up the MCP server:

1. **Copy the MCP configuration**:

```bash
cp .cursor/mcp.json.example .cursor/mcp.json
   ```

2. **Add your API keys**:

   ```json
   {
     "mcpServers": {
       "task-master-ai": {
         "command": "npx",
         "args": ["-y", "--package=task-master-ai", "task-master-ai"],
         "env": {
           "ANTHROPIC_API_KEY": "your-actual-key-here",
           "PERPLEXITY_API_KEY": "your-actual-key-here"
         }
       }
     }
   }
   ```

3. **Restart VS Code/Cursor**

📋 **For detailed setup instructions**, see [SETUP_ENVIRONMENT.md](SETUP_ENVIRONMENT.md)  
🔒 **For security guidelines**, see [SECURITY.md](SECURITY.md)

---

## 📖 Usage Guide

### Tree View Navigation

The extension organizes tasks in a hierarchical structure:

```
📊 Progress Overview
   ├── Total Tasks: 12
   ├── ✅ Completed: 8 (67%)
   ├── 🔄 In Progress: 2 (17%)
   ├── ⭕ Todo: 1 (8%)
   └── ❌ Blocked: 1 (8%)

📋 Todo (1)
   └── 🔴 001: Set up authentication system [HIGH] ▶

🔄 In progress (2)
   ├── 🟡 002: Implement user dashboard ↳ 1 deps ▶
   └── 🔴 003: Add payment integration [CRITICAL] ▶

✅ Completed (8)
   ├── ✅ 004: Design wireframes
   └── ... (more completed tasks)
```

### Working with Tasks

#### **Viewing Task Details**

- **Single Click**: Select a task to see basic information
- **Right Click → Show Task Details**: View comprehensive task information
- **Expand Arrow (▶)**: Click to show/hide subtasks

#### **Quick Actions**

- **Right-click** any task for context menu:
  - 📋 Show Task Details
  - ▶️ Start Working
  - ✅ Mark Completed / 🔄 Mark In Progress / ⭕ Mark Todo / ❌ Mark Blocked
  - ➕ Add Subtask
  - 🔧 Expand Task (break into subtasks)
  - ✏️ Edit Task / Edit Title
  - 🔗 Set Dependencies
  - 📋 Copy Task Details
  - 🗑️ Delete Task

#### **Status Management**

- Use context menu or toolbar buttons to change task status
- Visual indicators show current status:
  - ⭕ **Todo**: Ready to work on
  - 🔄 **In Progress**: Currently being worked on
  - ✅ **Completed**: Finished and verified
  - ❌ **Blocked**: Cannot proceed due to dependencies

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+P` → "Claude Task Master: Refresh" | Refresh task view |
| `Ctrl+Shift+P` → "Claude Task Master: Show Next Task" | Find next available task |
| `Ctrl+Shift+P` → "Claude Task Master: Add Task" | Create new task |
| `Ctrl+Shift+P` → "Claude Task Master: Search Tasks" | Search and filter tasks |

### Advanced Features

#### **Task Expansion** (Requires MCP)

- Right-click a complex task → "Expand Task"
- The extension will use AI to break down the task into manageable subtasks
- Each subtask gets implementation details and test strategies

#### **Next Task Recommendations**

- Click the "Next Task" button in the toolbar
- The extension analyzes dependencies and priorities to suggest what to work on next
- Helps maintain optimal workflow and avoid dependency conflicts

#### **Search and Filtering**

- Use the search icon in the toolbar
- Filter by status, priority, or text content
- Quickly find specific tasks in large projects

---

## 🔄 CLI Fallback System

The extension includes a robust CLI fallback system that ensures full functionality even when the MCP server is unavailable:

### How It Works

1. **Automatic Detection**: The extension detects when MCP server is unavailable
2. **Seamless Fallback**: Automatically switches to CLI commands
3. **Full Functionality**: All operations work via CLI fallback

### Supported Operations

- ✅ Add Task → `npx task-master-ai add-task`
- ✅ Add Subtask → `npx task-master-ai add-subtask`
- ✅ Set Status → `npx task-master-ai set-status`
- ✅ Update Task → `npx task-master-ai update-task`
- ✅ Expand Task → `npx task-master-ai expand`

### Performance Notes

- **MCP Operations**: Fast (< 1 second)
- **CLI Operations**: Slower (2-5 seconds) but reliable
- **No Broken Functionality**: Everything works regardless of MCP status

---

## 🏗️ Contributing

We welcome contributions! This extension is designed to enhance the task-master-ai ecosystem.

### Development Setup

1. **Clone the repository**:

   ```bash
   git clone https://github.com/DevDreed/claude-task-master-extension.git
   cd claude-task-master-extension
   ```

2. **Install dependencies**:

   ```bash
   npm install
   ```

3. **Set up test environment**:

   ```bash
   # Create a test project with task-master-ai
   mkdir test-project
   cd test-project
   npx task-master-ai init
   cd ..
   ```

4. **Open in VS Code**:

   ```bash
   code .
   ```

5. **Run the extension**:
   - Press `F5` to launch Extension Development Host
   - Open your test project in the new window
   - The extension should activate automatically

### Development Commands

```bash
# Compile TypeScript
npm run compile

# Watch for changes (development)
npm run watch

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Lint code
npm run lint

# Package extension
npm run package
```

### Testing

The extension has comprehensive test coverage:

- **130 tests** covering all major functionality
- **100% pass rate** with robust error handling
- **Mock frameworks** for isolated testing
- **Cross-platform** compatibility testing

```bash
# Run all tests
npm test

# Run specific test suite
npm test -- --grep "TaskProvider"

# Generate coverage report
npm run test:coverage
```

### Code Quality

We maintain high code quality standards:

- **TypeScript** with strict type checking
- **ESLint** for code style consistency
- **Comprehensive error handling**
- **Performance optimization**
- **Security best practices**

### Contribution Guidelines

1. **Fork the repository** and create a feature branch
2. **Write tests** for new functionality
3. **Ensure all tests pass**: `npm test`
4. **Follow TypeScript best practices**
5. **Update documentation** as needed
6. **Submit a Pull Request** with clear description

### Areas for Contribution

- 🎨 **UI/UX Improvements**: Enhanced styling, animations, accessibility
- ⚡ **Performance**: Optimization for large task lists
- 🔌 **Integrations**: Additional IDE features, external tool integrations
- 🧪 **Testing**: Additional test scenarios, edge cases
- 📖 **Documentation**: Examples, tutorials, use cases
- 🌐 **Internationalization**: Multi-language support

### Code of Conduct

- Be respectful and inclusive
- Focus on constructive feedback
- Help maintain a welcoming community
- Follow the project's coding standards

---

## 🛠️ Troubleshooting

### Common Issues

#### Extension Not Activating

- ✅ Ensure you have a `.taskmaster` directory in your workspace
- ✅ Try running `task-master-ai init` in your project
- ✅ Restart VS Code/Cursor
- ✅ Check the Output panel for error messages

#### Tasks Not Displaying

- ✅ Verify `tasks.json` exists in `.taskmaster/tasks/`
- ✅ Check file permissions
- ✅ Try refreshing the tree view (refresh button)
- ✅ Enable development mode for detailed logging

#### MCP Features Not Working

- ✅ Verify MCP configuration in `.cursor/mcp.json`
- ✅ Check API keys are properly set
- ✅ Restart VS Code/Cursor after MCP changes
- ✅ Check if CLI fallback is working instead

#### Performance Issues

- ✅ Disable auto-refresh if you have many tasks: `"claudeTaskMaster.autoRefresh": false`
- ✅ Check for very large task files
- ✅ Enable development mode to identify bottlenecks

### Getting Help

1. **Check the documentation**: [SETUP_ENVIRONMENT.md](SETUP_ENVIRONMENT.md), [SECURITY.md](SECURITY.md)
2. **Search existing issues**: [GitHub Issues](https://github.com/DevDreed/claude-task-master-extension/issues)
3. **Enable debug logging**: Set `"claudeTaskMaster.developmentMode": true`
4. **Create an issue**: Include VS Code version, extension version, and error messages

---

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- **[task-master-ai](https://github.com/eyaltoledano/claude-task-master)**: The core task management system this extension enhances
- **VS Code Team**: For the excellent extension API and development tools
- **Community Contributors**: Thank you to everyone who helps improve this extension

---

## 📊 Project Status

- ✅ **Current Release**: Version 1.2.2 with enhanced stability and reliability  
- ✅ **Comprehensive Testing**: 130 tests with 100% pass rate
- ✅ **Professional Documentation**: Complete setup and usage guides
- ✅ **Cross-platform Support**: Windows, macOS, Linux
- ✅ **Active Development**: Regular updates and feature additions

**Ready for production use in professional development workflows.**

---

*Made with ❤️ for the task-master-ai community*
