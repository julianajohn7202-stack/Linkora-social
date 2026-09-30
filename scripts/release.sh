#!/bin/bash

# Linkora-socials Release Script
# This script automates version bumping, changelog updates, and git tagging

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if tag already exists
tag_exists() {
    git rev-parse "$1" >/dev/null 2>&1
}

# Function to get current version from contract Cargo.toml
get_current_version() {
    grep -m 1 "^version = " packages/contracts/contracts/linkora-contracts/Cargo.toml | sed 's/version = "\(.*\)"/\1/'
}

# Function to get current version from root package.json
get_root_version() {
    grep -m 1 "\"version\":" package.json | sed 's/.*"version": "\(.*\)".*/\1/'
}

# Function to get current version from a service/package package.json
get_package_version() {
    local pkg_path=$1
    grep -m 1 "\"version\":" "$pkg_path/package.json" | sed 's/.*"version": "\(.*\)".*/\1/'
}

# Function to update version in Cargo.toml
update_contract_version() {
    local new_version=$1
    sed -i.bak "s/^version = .*/version = \"$new_version\"/" packages/contracts/contracts/linkora-contracts/Cargo.toml
    rm packages/contracts/contracts/linkora-contracts/Cargo.toml.bak
    print_info "Updated contract version to $new_version"
}

# Function to update version in root package.json
update_root_version() {
    local new_version=$1
    sed -i.bak "s/\"version\": \".*\"/\"version\": \"$new_version\"/" package.json
    rm package.json.bak
    print_info "Updated root package.json version to $new_version"
}

# Function to update version in a service/package package.json
update_package_version() {
    local pkg_path=$1
    local new_version=$2
    local pkg_name=$3
    sed -i.bak "s/\"version\": \".*\"/\"version\": \"$new_version\"/" "$pkg_path/package.json"
    rm "$pkg_path/package.json.bak"
    print_info "Updated $pkg_name version to $new_version"
}

# Function to tag a Docker image for a service
tag_docker_image() {
    local service=$1
    local new_version=$2
    local image_name="linkora/$service"

    if command -v docker >/dev/null 2>&1; then
        # Check if a local image with the 'latest' tag exists for this service
        if docker image inspect "${image_name}:latest" >/dev/null 2>&1; then
            docker tag "${image_name}:latest" "${image_name}:v${new_version}"
            print_info "Tagged Docker image ${image_name}:v${new_version}"
        else
            print_warning "Docker image ${image_name}:latest not found locally — skipping local tag"
            print_info "CI/CD will tag ${image_name}:v${new_version} on next build"
        fi
    else
        print_warning "Docker not available — skipping local image tagging for $service"
        print_info "CI/CD will tag ${image_name}:v${new_version} on next build"
    fi
}

# Function to add changelog entry
add_changelog_entry() {
    local version=$1
    local date=$(date +%Y-%m-%d)

    # Create a temporary file with the new entry
    local temp_file=$(mktemp)
    cat > "$temp_file" << EOF

## [$version] - $date

### Added
- 

### Changed
- analytics-oracle: bumped to v$version
- dm-relay: bumped to v$version
- indexer: bumped to v$version
- contracts: bumped to v$version

### Fixed
- 

EOF

    # Insert the new entry after the header section
    local header_end=$(grep -n "^## \[" CHANGELOG.md | tail -1 | cut -d: -f1)
    if [ -z "$header_end" ]; then
        # No existing entries, add after the header
        header_end=$(grep -n "^and this project follows" CHANGELOG.md | cut -d: -f1)
    fi

    head -n "$header_end" CHANGELOG.md > "${temp_file}.new"
    cat "$temp_file" >> "${temp_file}.new"
    tail -n +$((header_end + 1)) CHANGELOG.md >> "${temp_file}.new"

    mv "${temp_file}.new" CHANGELOG.md
    rm "$temp_file"

    print_info "Added changelog entry for version $version"
    print_warning "Please edit CHANGELOG.md to add the actual changes"
}

# Function to create git tag
create_git_tag() {
    local version=$1
    git add -A
    git commit -m "Release $version"
    git tag -a "v$version" -m "Release $version"
    print_info "Created git tag v$version"
}

# Main script logic
main() {
    print_info "Linkora-socials Release Script"
    print_info "=============================="

    # Check if we're in a git repository
    if ! git rev-parse --git-head > /dev/null 2>&1; then
        print_error "Not in a git repository"
        exit 1
    fi

    # Check if working directory is clean
    if [ -n "$(git status --porcelain)" ]; then
        print_error "Working directory is not clean. Please commit or stash changes first."
        exit 1
    fi

    # Get current versions
    local current_contract_version=$(get_current_version)
    local current_root_version=$(get_root_version)

    print_info "Current contract version: $current_contract_version"
    print_info "Current root version: $current_root_version"

    # Show current versions of new packages
    local analytics_version=$(get_package_version "services/analytics-oracle")
    local dm_relay_version=$(get_package_version "services/dm-relay")
    local indexer_version=$(get_package_version "services/indexer")

    print_info "Current analytics-oracle version: $analytics_version"
    print_info "Current dm-relay version: $dm_relay_version"
    print_info "Current indexer version: $indexer_version"

    # Check if versions are in sync
    if [ "$current_contract_version" != "$current_root_version" ]; then
        print_warning "Contract and root versions are not in sync"
    fi

    # Prompt for new version
    echo -n "Enter new version (current: $current_contract_version): "
    read new_version

    if [ -z "$new_version" ]; then
        print_error "Version cannot be empty"
        exit 1
    fi

    # Check if version is valid (basic semantic version check)
    if ! [[ "$new_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        print_error "Invalid version format. Use semantic versioning (e.g., 0.1.0)"
        exit 1
    fi

    # Check if tag already exists
    if tag_exists "v$new_version"; then
        print_error "Tag v$new_version already exists"
        exit 1
    fi

    # Check if version is the same as current
    if [ "$new_version" = "$current_contract_version" ]; then
        print_error "New version is the same as current version"
        exit 1
    fi

    print_info "Preparing release $new_version"

    # Update core package versions
    update_contract_version "$new_version"
    update_root_version "$new_version"

    # Update new service/package versions
    update_package_version "services/analytics-oracle" "$new_version" "analytics-oracle"
    update_package_version "services/dm-relay" "$new_version" "dm-relay"
    update_package_version "services/indexer" "$new_version" "indexer"

    # Update TypeScript package versions (sdk, types, codegen)
    update_package_version "packages/sdk" "$new_version" "sdk"
    update_package_version "packages/types" "$new_version" "types"
    update_package_version "packages/codegen" "$new_version" "codegen"

    # Tag Docker images for services that ship containers
    print_info "Tagging Docker images for services..."
    tag_docker_image "indexer" "$new_version"
    tag_docker_image "dm-relay" "$new_version"
    tag_docker_image "analytics-oracle" "$new_version"

    # Add changelog entry (includes new package versions)
    add_changelog_entry "$new_version"

    # Create git tag
    create_git_tag "$new_version"

    print_info "Release $new_version prepared successfully!"
    print_info "Next steps:"
    print_info "1. Edit CHANGELOG.md to add the actual changes"
    print_info "2. Review the changes with 'git diff HEAD~1'"
    print_info "3. Push with: git push && git push --tags"
    print_info "4. Create a GitHub release from the tag"
    print_info "5. CI will build and push Docker images:"
    print_info "   - linkora/indexer:v$new_version"
    print_info "   - linkora/dm-relay:v$new_version"
    print_info "   - linkora/analytics-oracle:v$new_version"
}

# Check if script is being sourced or executed
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
