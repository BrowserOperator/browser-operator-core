#!/bin/bash

# Browser Operator DevTools Frontend Setup Script
# This script automates the setup process for the Browser Operator DevTools Frontend

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[*]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[✓]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

print_error() {
    echo -e "${RED}[✗]${NC} $1"
}

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to detect the platform
detect_platform() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "macos"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        echo "linux"
    elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
        echo "windows"
    else
        echo "unknown"
    fi
}

# Main setup function
main() {
    echo "================================================="
    echo "Browser Operator DevTools Frontend Setup"
    echo "================================================="
    echo ""

    # Check prerequisites
    print_status "Checking prerequisites..."
    
    if ! command_exists git; then
        print_error "git is not installed. Please install git first."
        exit 1
    fi
    
    if ! command_exists npm; then
        print_error "npm is not installed. Please install Node.js and npm first."
        exit 1
    fi
    
    if ! command_exists python3; then
        print_warning "python3 is not installed. You'll need it to serve the built files."
    fi
    
    print_success "Prerequisites check completed"
    echo ""

    # Step 1: Check if depot_tools is already installed
    print_status "Checking depot_tools..."
    
    if ! command_exists fetch || ! command_exists gclient; then
        print_warning "depot_tools not found in PATH. Setting up depot_tools..."
        
        # Check if depot_tools directory exists
        if [ ! -d "$HOME/depot_tools" ]; then
            print_status "Cloning depot_tools..."
            git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git "$HOME/depot_tools"
        fi
        
        # Add depot_tools to PATH
        export PATH="$PATH:$HOME/depot_tools"
        
        # Add to shell profile
        SHELL_PROFILE=""
        if [ -f "$HOME/.zshrc" ]; then
            SHELL_PROFILE="$HOME/.zshrc"
        elif [ -f "$HOME/.bashrc" ]; then
            SHELL_PROFILE="$HOME/.bashrc"
        elif [ -f "$HOME/.bash_profile" ]; then
            SHELL_PROFILE="$HOME/.bash_profile"
        fi
        
        if [ -n "$SHELL_PROFILE" ]; then
            if ! grep -q "depot_tools" "$SHELL_PROFILE"; then
                echo 'export PATH="$PATH:$HOME/depot_tools"' >> "$SHELL_PROFILE"
                print_success "Added depot_tools to $SHELL_PROFILE"
                print_warning "Please restart your terminal or run: source $SHELL_PROFILE"
            fi
        fi
    else
        print_success "depot_tools is already installed"
    fi
    echo ""

    # Step 2: Check if we're in the right directory
    print_status "Checking current directory..."
    
    if [ -f "package.json" ] && grep -q "devtools-frontend" "package.json"; then
        print_success "Already in devtools-frontend directory"
        DEVTOOLS_DIR="."
    else
        print_warning "Not in devtools-frontend directory"
        
        # Check if devtools directory exists
        if [ -d "devtools/devtools-frontend" ]; then
            DEVTOOLS_DIR="devtools/devtools-frontend"
            cd "$DEVTOOLS_DIR"
            print_success "Found existing devtools-frontend at $DEVTOOLS_DIR"
        else
            print_status "Creating devtools directory and fetching code..."
            mkdir -p devtools
            cd devtools
            
            print_status "Fetching devtools-frontend (this may take a while)..."
            fetch devtools-frontend
            
            cd devtools-frontend
            DEVTOOLS_DIR="."
            print_success "Successfully fetched devtools-frontend"
        fi
    fi
    echo ""

    # Step 3: Sync dependencies
    print_status "Syncing dependencies with gclient..."
    gclient sync
    print_success "Dependencies synced"
    echo ""

    # Step 4: Add upstream remote if not exists
    print_status "Checking git remotes..."
    
    if ! git remote | grep -q "upstream"; then
        print_status "Adding upstream remote..."
        
        # Check if SSH key is available
        if ssh -T git@github.com 2>&1 | grep -q "successfully authenticated"; then
            print_status "SSH authentication available, using SSH URL..."
            git remote add upstream git@github.com:tysonthomas9/browser-operator-devtools-frontend.git
        else
            print_warning "SSH authentication not available, using HTTPS URL..."
            print_warning "You may need to enter your GitHub credentials"
            git remote add upstream https://github.com/tysonthomas9/browser-operator-devtools-frontend.git
            
            echo ""
            print_warning "Note: To use SSH in the future, you need to:"
            print_warning "  1. Generate an SSH key: ssh-keygen -t ed25519 -C 'your_email@example.com'"
            print_warning "  2. Add the key to ssh-agent: ssh-add ~/.ssh/id_ed25519"
            print_warning "  3. Add the public key to GitHub: https://github.com/settings/keys"
            echo ""
        fi
        
        print_success "Added upstream remote"
    else
        print_success "Upstream remote already exists"
    fi
    
    # Fetch upstream
    print_status "Fetching upstream changes..."
    if ! git fetch upstream 2>/dev/null; then
        print_error "Failed to fetch upstream. Checking remote URL..."
        
        # Get current URL
        CURRENT_URL=$(git remote get-url upstream)
        
        if [[ "$CURRENT_URL" == git@github.com:* ]]; then
            print_warning "Current remote uses SSH. Switching to HTTPS..."
            git remote set-url upstream https://github.com/tysonthomas9/browser-operator-devtools-frontend.git
            
            print_status "Retrying fetch with HTTPS..."
            git fetch upstream
        else
            print_error "Unable to fetch from upstream. Please check your internet connection."
            exit 1
        fi
    fi
    
    print_success "Fetched upstream changes"
    echo ""

    # Step 5: Ask user if they want to checkout upstream/main
    read -p "Do you want to checkout the Browser Operator fork (upstream/main)? [y/N] " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        print_status "Checking out upstream/main..."
        git checkout upstream/main
        print_success "Checked out upstream/main"
    else
        print_warning "Skipping checkout of upstream/main"
    fi
    echo ""

    # Step 6: Install npm dependencies
    print_status "Installing npm dependencies..."
    npm install
    print_success "npm dependencies installed"
    echo ""

    # Step 7: Build the project
    print_status "Building the project..."
    npm run build
    print_success "Project built successfully"
    echo ""

    # Step 8: Create helper scripts
    print_status "Creating helper scripts..."
    
    # Create dev.sh script
    cat > dev.sh << 'EOF'
#!/bin/bash
# Development helper script

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}Starting development environment...${NC}"

# Start build watch in background
echo -e "${BLUE}Starting build watch...${NC}"
npm run build -- --watch &
BUILD_PID=$!

# Wait for initial build
sleep 5

# Start HTTP server
echo -e "${BLUE}Starting HTTP server on port 8000...${NC}"
cd out/Default/gen/front_end
python3 -m http.server &
SERVER_PID=$!

echo -e "${GREEN}Development environment started!${NC}"
echo ""
echo "Build watch PID: $BUILD_PID"
echo "HTTP server PID: $SERVER_PID"
echo ""
echo "DevTools available at: http://localhost:8000/"
echo ""
echo "To stop all processes, run: kill $BUILD_PID $SERVER_PID"

# Wait for user to press Ctrl+C
trap "kill $BUILD_PID $SERVER_PID; exit" INT
wait
EOF
    
    chmod +x dev.sh
    print_success "Created dev.sh helper script"
    
    # Create run-chrome.sh script
    PLATFORM=$(detect_platform)
    
    cat > run-chrome.sh << 'EOF'
#!/bin/bash
# Chrome launcher script

PLATFORM="'$PLATFORM'"

case $PLATFORM in
    macos)
        # Try Chrome Canary first, then regular Chrome
        if [ -f "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary" ]; then
            CHROME_PATH="/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"
        elif [ -f "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
            CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        else
            echo "Chrome not found. Please install Google Chrome or Chrome Canary."
            exit 1
        fi
        ;;
    linux)
        # Try various Chrome locations on Linux
        if command -v google-chrome-stable >/dev/null 2>&1; then
            CHROME_PATH="google-chrome-stable"
        elif command -v google-chrome >/dev/null 2>&1; then
            CHROME_PATH="google-chrome"
        elif command -v chromium-browser >/dev/null 2>&1; then
            CHROME_PATH="chromium-browser"
        elif command -v chromium >/dev/null 2>&1; then
            CHROME_PATH="chromium"
        else
            echo "Chrome/Chromium not found. Please install Google Chrome or Chromium."
            exit 1
        fi
        ;;
    windows)
        # Common Chrome locations on Windows
        if [ -f "/c/Program Files/Google/Chrome/Application/chrome.exe" ]; then
            CHROME_PATH="/c/Program Files/Google/Chrome/Application/chrome.exe"
        elif [ -f "/c/Program Files (x86)/Google/Chrome/Application/chrome.exe" ]; then
            CHROME_PATH="/c/Program Files (x86)/Google/Chrome/Application/chrome.exe"
        else
            echo "Chrome not found. Please install Google Chrome."
            exit 1
        fi
        ;;
    *)
        echo "Unknown platform. Please set CHROME_PATH manually."
        exit 1
        ;;
esac

echo "Launching Chrome with custom DevTools..."
echo "Chrome path: $CHROME_PATH"
echo ""

"$CHROME_PATH" --disable-infobars --custom-devtools-frontend=http://localhost:8000/
EOF
    
    chmod +x run-chrome.sh
    print_success "Created run-chrome.sh helper script"
    echo ""

    # Final instructions
    echo "================================================="
    echo -e "${GREEN}Setup completed successfully!${NC}"
    echo "================================================="
    echo ""
    echo "To start development:"
    echo "  1. Run: ./dev.sh"
    echo "  2. In another terminal, run: ./run-chrome.sh"
    echo ""
    echo "Alternative manual steps:"
    echo "  1. Build with watch: npm run build -- --watch"
    echo "  2. Serve files: cd out/Default/gen/front_end && python3 -m http.server"
    echo "  3. Launch Chrome with: --custom-devtools-frontend=http://localhost:8000/"
    echo ""
    echo "For more information, see: front_end/panels/ai_chat/Readme.md"
}

# Run the main function
main