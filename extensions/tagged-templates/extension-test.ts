export {};
// =============================================================================
// Tagged Template Literals — Syntax Highlighting Test File
// =============================================================================
// Each section below uses a tag function matching the default config name.
// To test a language, add its tag to your settings under "tagged-templates.tags".
//
// Default config:  { "html": "html", "css": "css" }
// Full test config (add to settings.json):
// "tagged-templates.tags": {
//   "html": "html",       "css": "css",          "sql": "sql",
//   "json": "json",       "xml": "xml",          "yaml": "yaml",
//   "markdown": "markdown","graphql": "graphql",  "scss": "scss",
//   "less": "less",       "glsl": "glsl",        "javascript": "javascript",
//   "typescript": "typescript", "python": "python", "ruby": "ruby",
//   "go": "go",           "rust": "rust",        "c": "c",
//   "cpp": "cpp",         "csharp": "csharp",    "java": "java",
//   "php": "php",         "shell": "shellscript", "lua": "lua",
//   "perl": "perl",       "r": "r",              "dart": "dart",
//   "swift": "swift",     "kotlin": "kotlin",    "dockerfile": "dockerfile",
//   "ini": "ini",         "toml": "toml",        "regex": "regex",
//   "powershell": "powershell"
// }
// =============================================================================

// Declare tag functions so TypeScript doesn't complain
declare function html(s: TemplateStringsArray, ...v: any[]): string;
declare function css(s: TemplateStringsArray, ...v: any[]): string;
declare function sql(s: TemplateStringsArray, ...v: any[]): string;
declare function json(s: TemplateStringsArray, ...v: any[]): string;
declare function xml(s: TemplateStringsArray, ...v: any[]): string;
declare function yaml(s: TemplateStringsArray, ...v: any[]): string;
declare function markdown(s: TemplateStringsArray, ...v: any[]): string;
declare function graphql(s: TemplateStringsArray, ...v: any[]): string;
declare function scss(s: TemplateStringsArray, ...v: any[]): string;
declare function less(s: TemplateStringsArray, ...v: any[]): string;
declare function glsl(s: TemplateStringsArray, ...v: any[]): string;
declare function javascript(s: TemplateStringsArray, ...v: any[]): string;
declare function typescript(s: TemplateStringsArray, ...v: any[]): string;
declare function python(s: TemplateStringsArray, ...v: any[]): string;
declare function ruby(s: TemplateStringsArray, ...v: any[]): string;
declare function go(s: TemplateStringsArray, ...v: any[]): string;
declare function rust(s: TemplateStringsArray, ...v: any[]): string;
declare function c(s: TemplateStringsArray, ...v: any[]): string;
declare function cpp(s: TemplateStringsArray, ...v: any[]): string;
declare function csharp(s: TemplateStringsArray, ...v: any[]): string;
declare function java(s: TemplateStringsArray, ...v: any[]): string;
declare function php(s: TemplateStringsArray, ...v: any[]): string;
declare function shell(s: TemplateStringsArray, ...v: any[]): string;
declare function lua(s: TemplateStringsArray, ...v: any[]): string;
declare function perl(s: TemplateStringsArray, ...v: any[]): string;
declare function r(s: TemplateStringsArray, ...v: any[]): string;
declare function dart(s: TemplateStringsArray, ...v: any[]): string;
declare function swift(s: TemplateStringsArray, ...v: any[]): string;
declare function kotlin(s: TemplateStringsArray, ...v: any[]): string;
declare function dockerfile(s: TemplateStringsArray, ...v: any[]): string;
declare function ini(s: TemplateStringsArray, ...v: any[]): string;
declare function toml(s: TemplateStringsArray, ...v: any[]): string;
declare function regex(s: TemplateStringsArray, ...v: any[]): string;
declare function powershell(s: TemplateStringsArray, ...v: any[]): string;

const name = "World";
const count = 42;

// =============================================================================
// 1. HTML  (default — works out of the box)
// =============================================================================
const htmlExample = html`
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Hello ${name}</title>
  </head>
  <body>
    <div class="container" id="main">
      <h1>Welcome, ${name}!</h1>
      <p>You have <strong>${count}</strong> items.</p>
      <ul>
        <li><a href="/home">Home</a></li>
        <li><a href="/about">About</a></li>
      </ul>
      <input type="text" placeholder="Search..." disabled />
      <!-- This is a comment -->
    </div>
  </body>
  </html>
`;

// =============================================================================
// 2. CSS  (default — works out of the box)
// =============================================================================
const cssExample = css`
  :root {
    --primary: #3b82f6;
    --spacing: 1rem;
  }

  .container {
    display: flex;
    flex-direction: column;
    gap: var(--spacing);
    max-width: 960px;
    margin: 0 auto;
    padding: ${count}px;
  }

  .container > h1 {
    font-size: 2rem;
    color: var(--primary);
    text-transform: uppercase;
  }

  @media (max-width: 768px) {
    .container {
      padding: 0.5rem;
    }
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
`;

// =============================================================================
// 3. SQL
// =============================================================================
const sqlExample = sql`
  SELECT u.id, u.name, u.email, COUNT(o.id) AS order_count
  FROM users u
  LEFT JOIN orders o ON o.user_id = u.id
  WHERE u.active = TRUE
    AND u.created_at >= '2025-01-01'
    AND u.name LIKE '%${name}%'
  GROUP BY u.id, u.name, u.email
  HAVING COUNT(o.id) > ${count}
  ORDER BY order_count DESC
  LIMIT 50 OFFSET 0;

  INSERT INTO logs (event, details, created_at)
  VALUES ('login', '{"user": "${name}"}', NOW());

  CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    price DECIMAL(10, 2) DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`;

// =============================================================================
// 4. JSON
// =============================================================================
const jsonExample = json`
  {
    "name": "${name}",
    "version": "1.0.0",
    "dependencies": {
      "express": "^4.18.0",
      "typescript": "~5.3.0"
    },
    "config": {
      "port": 3000,
      "debug": true,
      "features": ["auth", "logging", "cache"],
      "database": {
        "host": "localhost",
        "pool": { "min": 2, "max": 10 }
      }
    },
    "count": ${count}
  }
`;

// =============================================================================
// 5. XML
// =============================================================================
const xmlExample = xml`
  <?xml version="1.0" encoding="UTF-8"?>
  <catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <book id="bk101">
      <author>${name}</author>
      <title>XML Developer's Guide</title>
      <genre>Computer</genre>
      <price>44.95</price>
      <publish_date>2025-10-01</publish_date>
      <description>An in-depth look at creating applications with XML.</description>
    </book>
    <book id="bk102">
      <author>Garcia, Bonnie</author>
      <title>Midnight Rain</title>
      <genre>Fantasy</genre>
      <price>5.95</price>
    </book>
    <!-- ${count} books in catalog -->
  </catalog>
`;

// =============================================================================
// 6. YAML
// =============================================================================
const yamlExample = yaml`
  apiVersion: apps/v1
  kind: Deployment
  metadata:
    name: ${name}-app
    labels:
      app: web-server
      version: "2.0"
  spec:
    replicas: ${count}
    selector:
      matchLabels:
        app: web-server
    template:
      spec:
        containers:
          - name: app
            image: node:20-alpine
            ports:
              - containerPort: 3000
            env:
              - name: NODE_ENV
                value: production
            resources:
              limits:
                memory: "256Mi"
                cpu: "500m"
`;

// =============================================================================
// 7. Markdown
// =============================================================================
const markdownExample = markdown`
  # Hello ${name}

  This is a **bold** and *italic* demonstration.

  ## Features

  - Item one with \`inline code\`
  - Item two with [a link](https://example.com)
  - Item three: ${count} things

  ### Code Block

  \`\`\`typescript
  const x = 42;
  console.log(x);
  \`\`\`

  > Blockquote with some wisdom

  | Column A | Column B | Column C |
  |----------|----------|----------|
  | Alpha    | Beta     | Gamma    |
  | 1        | 2        | 3        |
`;

// =============================================================================
// 8. GraphQL
// =============================================================================
const graphqlExample = graphql`
  query GetUser($id: ID!) {
    user(id: $id) {
      id
      name
      email
      posts(first: ${count}) {
        edges {
          node {
            title
            body
            createdAt
            comments {
              totalCount
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }

  mutation CreateUser($input: CreateUserInput!) {
    createUser(input: $input) {
      user {
        id
        name
      }
      errors {
        field
        message
      }
    }
  }

  fragment UserFields on User {
    id
    name
    email
    avatar
  }
`;

// =============================================================================
// 9. SCSS
// =============================================================================
const scssExample = scss`
  $primary: #3b82f6;
  $border-radius: 8px;
  $breakpoint-md: 768px;

  @mixin respond-to($bp) {
    @media (max-width: $bp) {
      @content;
    }
  }

  .card {
    border-radius: $border-radius;
    padding: 1rem;
    background: white;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);

    &__header {
      color: $primary;
      font-size: 1.5rem;
      border-bottom: 1px solid lighten($primary, 40%);
    }

    &__body {
      margin-top: 1rem;

      p {
        line-height: 1.6;
        color: darken(gray, 20%);
      }
    }

    @include respond-to($breakpoint-md) {
      padding: 0.5rem;
    }
  }
`;

// =============================================================================
// 10. Less
// =============================================================================
const lessExample = less`
  @primary: #3b82f6;
  @spacing: 1rem;

  .container {
    max-width: 960px;
    margin: 0 auto;

    .header {
      color: @primary;
      padding: @spacing;
      background: lighten(@primary, 40%);
    }

    .content {
      padding: @spacing * 2;

      &:hover {
        background: fade(@primary, 10%);
      }
    }
  }

  .mixin-example(@color, @size: 14px) {
    color: @color;
    font-size: @size;
  }

  .alert {
    .mixin-example(red, 16px);
    border: 1px solid currentColor;
  }
`;

// =============================================================================
// 11. GLSL
// =============================================================================
const glslExample = glsl`
  precision mediump float;

  uniform float u_time;
  uniform vec2 u_resolution;
  uniform sampler2D u_texture;

  varying vec2 v_texCoord;

  const float PI = 3.14159265359;

  vec3 palette(float t) {
    vec3 a = vec3(0.5, 0.5, 0.5);
    vec3 b = vec3(0.5, 0.5, 0.5);
    vec3 c = vec3(1.0, 1.0, 1.0);
    vec3 d = vec3(0.263, 0.416, 0.557);
    return a + b * cos(6.28318 * (c * t + d));
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution.xy;
    uv -= 0.5;
    uv.x *= u_resolution.x / u_resolution.y;

    float d = length(uv);
    vec3 col = palette(d + u_time * 0.4);
    d = sin(d * 8.0 + u_time) / 8.0;
    d = abs(d);
    d = 0.02 / d;

    col *= d;
    gl_FragColor = vec4(col, 1.0);
  }
`;

// =============================================================================
// 12. JavaScript
// =============================================================================
const javascriptExample = javascript`
  import express from 'express';

  const app = express();
  const PORT = 3000;

  // Middleware
  app.use(express.json());
  app.use((req, res, next) => {
    console.log(\`[\${new Date().toISOString()}] \${req.method} \${req.path}\`);
    next();
  });

  // Routes
  app.get('/api/users', async (req, res) => {
    try {
      const users = await db.query('SELECT * FROM users');
      res.json({ data: users, count: users.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.listen(PORT, () => {
    console.log(\`Server running on port \${PORT}\`);
  });
`;

// =============================================================================
// 13. TypeScript
// =============================================================================
const typescriptExample = typescript`
  interface User {
    id: number;
    name: string;
    email: string;
    roles: ReadonlyArray<'admin' | 'user' | 'moderator'>;
  }

  type Result<T, E = Error> = 
    | { ok: true; value: T }
    | { ok: false; error: E };

  async function fetchUser(id: number): Promise<Result<User>> {
    try {
      const response = await fetch(\`/api/users/\${id}\`);
      if (!response.ok) {
        throw new Error(\`HTTP \${response.status}\`);
      }
      const user: User = await response.json();
      return { ok: true, value: user };
    } catch (error) {
      return { ok: false, error: error as Error };
    }
  }

  const enum Status {
    Active = 'ACTIVE',
    Inactive = 'INACTIVE',
    Pending = 'PENDING',
  }

  class UserService {
    private cache = new Map<number, User>();

    async getUser(id: number): Promise<User | null> {
      if (this.cache.has(id)) {
        return this.cache.get(id)!;
      }
      const result = await fetchUser(id);
      if (result.ok) {
        this.cache.set(id, result.value);
        return result.value;
      }
      return null;
    }
  }
`;

// =============================================================================
// 14. Python
// =============================================================================
const pythonExample = python`
  import asyncio
  from dataclasses import dataclass, field
  from typing import Optional, List

  @dataclass
  class User:
      name: str
      email: str
      age: int = 0
      tags: List[str] = field(default_factory=list)

      @property
      def display_name(self) -> str:
          return f"{self.name} <{self.email}>"

      def __repr__(self) -> str:
          return f"User(name={self.name!r}, age={self.age})"

  async def fetch_users(url: str) -> List[User]:
      """Fetch users from API endpoint."""
      users = []
      async with aiohttp.ClientSession() as session:
          async with session.get(url) as response:
              data = await response.json()
              for item in data:
                  users.append(User(**item))
      return users

  # List comprehension with filtering
  active_users = [u for u in users if u.age >= 18 and 'active' in u.tags]

  # Dictionary comprehension
  user_map = {u.email: u for u in active_users}

  if __name__ == "__main__":
      asyncio.run(fetch_users("https://api.example.com/users"))
`;

// =============================================================================
// 15. Ruby
// =============================================================================
const rubyExample = ruby`
  # frozen_string_literal: true

  module Authentication
    class User
      attr_accessor :name, :email, :role

      def initialize(name:, email:, role: :user)
        @name = name
        @email = email
        @role = role
      end

      def admin?
        role == :admin
      end

      def to_s
        "#{name} (#{email})"
      end
    end
  end

  class UsersController < ApplicationController
    before_action :authenticate!

    def index
      @users = User.where(active: true)
                    .includes(:profile)
                    .order(created_at: :desc)
                    .limit(50)

      render json: @users.map { |u| serialize(u) }
    end

    private

    def serialize(user)
      { id: user.id, name: user.name, email: user.email }
    end
  end

  # Block and yield
  3.times do |i|
    puts "Iteration #{i + 1}"
  end
`;

// =============================================================================
// 16. Go
// =============================================================================
const goExample = go`
  package main

  import (
      "encoding/json"
      "fmt"
      "log"
      "net/http"
      "sync"
  )

  type User struct {
      ID    int    \`json:"id"\`
      Name  string \`json:"name"\`
      Email string \`json:"email"\`
  }

  type UserStore struct {
      mu    sync.RWMutex
      users map[int]*User
  }

  func NewUserStore() *UserStore {
      return &UserStore{
          users: make(map[int]*User),
      }
  }

  func (s *UserStore) Get(id int) (*User, bool) {
      s.mu.RLock()
      defer s.mu.RUnlock()
      u, ok := s.users[id]
      return u, ok
  }

  func handleGetUser(store *UserStore) http.HandlerFunc {
      return func(w http.ResponseWriter, r *http.Request) {
          user, ok := store.Get(1)
          if !ok {
              http.Error(w, "not found", http.StatusNotFound)
              return
          }
          w.Header().Set("Content-Type", "application/json")
          json.NewEncoder(w).Encode(user)
      }
  }

  func main() {
      store := NewUserStore()
      http.HandleFunc("/user", handleGetUser(store))
      fmt.Println("Listening on :8080")
      log.Fatal(http.ListenAndServe(":8080", nil))
  }
`;

// =============================================================================
// 17. Rust
// =============================================================================
const rustExample = rust`
  use std::collections::HashMap;
  use std::sync::{Arc, Mutex};

  #[derive(Debug, Clone)]
  struct User {
      id: u64,
      name: String,
      email: String,
  }

  impl User {
      fn new(id: u64, name: &str, email: &str) -> Self {
          User {
              id,
              name: name.to_string(),
              email: email.to_string(),
          }
      }

      fn display_name(&self) -> String {
          format!("{} <{}>", self.name, self.email)
      }
  }

  impl std::fmt::Display for User {
      fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
          write!(f, "User({}: {})", self.id, self.name)
      }
  }

  fn find_user(users: &[User], predicate: impl Fn(&User) -> bool) -> Option<&User> {
      users.iter().find(|u| predicate(u))
  }

  fn main() {
      let users = vec![
          User::new(1, "Alice", "alice@example.com"),
          User::new(2, "Bob", "bob@example.com"),
      ];

      let cache: Arc<Mutex<HashMap<u64, User>>> = Arc::new(Mutex::new(HashMap::new()));

      if let Some(user) = find_user(&users, |u| u.name == "Alice") {
          println!("Found: {}", user.display_name());
          cache.lock().unwrap().insert(user.id, user.clone());
      }

      // Pattern matching
      match users.len() {
          0 => println!("No users"),
          1 => println!("One user"),
          n => println!("{n} users found"),
      }
  }
`;

// =============================================================================
// 18. C
// =============================================================================
const cExample = c`
  #include <stdio.h>
  #include <stdlib.h>
  #include <string.h>

  #define MAX_USERS 100
  #define BUFFER_SIZE 256

  typedef struct {
      int id;
      char name[64];
      char email[128];
      int active;
  } User;

  typedef struct {
      User users[MAX_USERS];
      int count;
  } UserStore;

  UserStore* user_store_create(void) {
      UserStore* store = (UserStore*)malloc(sizeof(UserStore));
      if (store) {
          memset(store, 0, sizeof(UserStore));
      }
      return store;
  }

  int user_store_add(UserStore* store, const char* name, const char* email) {
      if (!store || store->count >= MAX_USERS) return -1;

      User* user = &store->users[store->count];
      user->id = store->count + 1;
      strncpy(user->name, name, sizeof(user->name) - 1);
      strncpy(user->email, email, sizeof(user->email) - 1);
      user->active = 1;

      return store->count++;
  }

  void user_store_print(const UserStore* store) {
      for (int i = 0; i < store->count; i++) {
          printf("User %d: %s (%s)\\n",
              store->users[i].id,
              store->users[i].name,
              store->users[i].email);
      }
  }

  int main(void) {
      UserStore* store = user_store_create();
      user_store_add(store, "Alice", "alice@example.com");
      user_store_add(store, "Bob", "bob@example.com");
      user_store_print(store);
      free(store);
      return 0;
  }
`;

// =============================================================================
// 19. C++
// =============================================================================
const cppExample = cpp`
  #include <iostream>
  #include <vector>
  #include <string>
  #include <memory>
  #include <algorithm>

  template<typename T>
  class Repository {
  public:
      void add(T item) {
          items_.push_back(std::move(item));
      }

      [[nodiscard]] auto find(const std::string& name) const
          -> std::optional<std::reference_wrapper<const T>>
      {
          auto it = std::find_if(items_.begin(), items_.end(),
              [&name](const auto& item) { return item.name == name; });
          if (it != items_.end()) return std::cref(*it);
          return std::nullopt;
      }

      [[nodiscard]] size_t size() const noexcept { return items_.size(); }

  private:
      std::vector<T> items_;
  };

  struct User {
      int id;
      std::string name;
      std::string email;

      friend std::ostream& operator<<(std::ostream& os, const User& u) {
          return os << "User(" << u.id << ": " << u.name << ")";
      }
  };

  int main() {
      auto repo = std::make_unique<Repository<User>>();
      repo->add({1, "Alice", "alice@example.com"});
      repo->add({2, "Bob", "bob@example.com"});

      if (auto user = repo->find("Alice")) {
          std::cout << "Found: " << user->get() << std::endl;
      }

      std::cout << "Total users: " << repo->size() << std::endl;
      return 0;
  }
`;

// =============================================================================
// 20. C#
// =============================================================================
const csharpExample = csharp`
  using System;
  using System.Collections.Generic;
  using System.Linq;
  using System.Threading.Tasks;

  namespace MyApp.Models
  {
      public record User(int Id, string Name, string Email);

      public interface IUserRepository
      {
          Task<User?> GetByIdAsync(int id);
          Task<IEnumerable<User>> GetAllAsync();
      }

      public class UserRepository : IUserRepository
      {
          private readonly List<User> _users = new();

          public async Task<User?> GetByIdAsync(int id)
          {
              await Task.Delay(10); // Simulate async
              return _users.FirstOrDefault(u => u.Id == id);
          }

          public async Task<IEnumerable<User>> GetAllAsync()
          {
              await Task.Delay(10);
              return _users.Where(u => u.Name.Length > 0)
                           .OrderBy(u => u.Name)
                           .ToList();
          }

          public void Add(User user) => _users.Add(user);
      }

      // Pattern matching and switch expressions
      public static class UserExtensions
      {
          public static string GetRole(this User user) => user.Name switch
          {
              "Admin" => "Administrator",
              var n when n.StartsWith("Mod") => "Moderator",
              _ => "User"
          };
      }
  }
`;

// =============================================================================
// 21. Java
// =============================================================================
const javaExample = java`
  package com.example.app;

  import java.util.*;
  import java.util.stream.Collectors;

  public class UserService {

      public record User(int id, String name, String email) {}

      private final Map<Integer, User> users = new HashMap<>();

      public Optional<User> findById(int id) {
          return Optional.ofNullable(users.get(id));
      }

      public List<User> findByNamePrefix(String prefix) {
          return users.values().stream()
              .filter(u -> u.name().startsWith(prefix))
              .sorted(Comparator.comparing(User::name))
              .collect(Collectors.toList());
      }

      public void addUser(User user) {
          users.put(user.id(), user);
      }

      @Override
      public String toString() {
          return "UserService{count=" + users.size() + "}";
      }

      public static void main(String[] args) {
          var service = new UserService();
          service.addUser(new User(1, "Alice", "alice@example.com"));
          service.addUser(new User(2, "Bob", "bob@example.com"));

          service.findById(1).ifPresent(u ->
              System.out.printf("Found: %s (%s)%n", u.name(), u.email())
          );
      }
  }
`;

// =============================================================================
// 22. PHP
// =============================================================================
const phpExample = php`
  <?php

  declare(strict_types=1);

  namespace App\\Models;

  class User
  {
      public function __construct(
          private readonly int $id,
          private string $name,
          private string $email,
          private array $roles = [],
      ) {}

      public function getId(): int
      {
          return $this->id;
      }

      public function getName(): string
      {
          return $this->name;
      }

      public function hasRole(string $role): bool
      {
          return in_array($role, $this->roles, true);
      }

      public function toArray(): array
      {
          return [
              'id' => $this->id,
              'name' => $this->name,
              'email' => $this->email,
              'roles' => $this->roles,
          ];
      }
  }

  // Usage
  $user = new User(1, 'Alice', 'alice@example.com', ['admin']);
  echo $user->getName() . "\\n";
  var_dump($user->hasRole('admin'));

  // Array functions
  $users = array_filter($allUsers, fn(User $u) => $u->hasRole('admin'));
  $names = array_map(fn(User $u) => $u->getName(), $users);
  ?>
`;

// =============================================================================
// 23. Shell / Bash
// =============================================================================
const shellExample = shell`
  #!/usr/bin/env bash
  set -euo pipefail

  # Configuration
  readonly APP_NAME="myapp"
  readonly LOG_DIR="/var/log/$APP_NAME"
  readonly MAX_RETRIES=3

  log() {
      local level="$1"; shift
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] [$level] $*" | tee -a "$LOG_DIR/app.log"
  }

  check_dependencies() {
      local deps=("curl" "jq" "docker")
      for dep in "\${deps[@]}"; do
          if ! command -v "$dep" &>/dev/null; then
              log "ERROR" "Missing dependency: $dep"
              exit 1
          fi
      done
      log "INFO" "All dependencies satisfied"
  }

  deploy() {
      local version="$1"
      local retries=0

      while (( retries < MAX_RETRIES )); do
          log "INFO" "Deploying version $version (attempt $((retries + 1)))"

          if docker pull "$APP_NAME:$version" 2>/dev/null; then
              docker stop "$APP_NAME" 2>/dev/null || true
              docker run -d --name "$APP_NAME" -p 8080:8080 "$APP_NAME:$version"
              log "INFO" "Deployment successful"
              return 0
          fi

          ((retries++))
          sleep 5
      done

      log "ERROR" "Deployment failed after $MAX_RETRIES attempts"
      return 1
  }

  # Main
  check_dependencies
  deploy "\${1:-latest}"
`;

// =============================================================================
// 24. Lua
// =============================================================================
const luaExample = lua`
  -- Simple class system
  local User = {}
  User.__index = User

  function User.new(id, name, email)
      local self = setmetatable({}, User)
      self.id = id
      self.name = name
      self.email = email
      self.active = true
      return self
  end

  function User:display()
      return string.format("User(%d: %s <%s>)", self.id, self.name, self.email)
  end

  function User:deactivate()
      self.active = false
      print(self.name .. " has been deactivated")
  end

  -- Table operations
  local users = {}
  table.insert(users, User.new(1, "Alice", "alice@example.com"))
  table.insert(users, User.new(2, "Bob", "bob@example.com"))
  table.insert(users, User.new(3, "Charlie", "charlie@example.com"))

  -- Filter active users
  local active = {}
  for _, user in ipairs(users) do
      if user.active then
          active[#active + 1] = user
      end
  end

  -- Print results
  for i, user in ipairs(active) do
      print(i .. ". " .. user:display())
  end

  -- Coroutine example
  local counter = coroutine.create(function()
      for i = 1, 10 do
          coroutine.yield(i)
      end
  end)
`;

// =============================================================================
// 25. Perl
// =============================================================================
const perlExample = perl`
  #!/usr/bin/perl
  use strict;
  use warnings;
  use v5.36;

  package User {
      sub new ($class, %args) {
          return bless {
              id    => $args{id},
              name  => $args{name},
              email => $args{email},
          }, $class;
      }

      sub name ($self)  { return $self->{name} }
      sub email ($self) { return $self->{email} }

      sub to_string ($self) {
          return sprintf("User(%d: %s)", $self->{id}, $self->{name});
      }
  }

  # Create users
  my @users = map {
      User->new(id => $_->[0], name => $_->[1], email => $_->[2])
  } (
      [1, "Alice", 'alice@example.com'],
      [2, "Bob",   'bob@example.com'],
  );

  # Regex matching and substitution
  my $text = "Hello World, hello Perl!";
  my @matches = ($text =~ /hello/gi);
  (my $replaced = $text) =~ s/hello/Hi/gi;

  # Hash operations
  my %user_map = map { $_->email() => $_ } @users;

  for my $email (sort keys %user_map) {
      say $user_map{$email}->to_string();
  }
`;

// =============================================================================
// 26. R
// =============================================================================
const rExample = r`
  library(tidyverse)
  library(ggplot2)

  # Create a data frame
  users <- data.frame(
    id = 1:5,
    name = c("Alice", "Bob", "Charlie", "Diana", "Eve"),
    score = c(92, 85, 78, 95, 88),
    department = c("Engineering", "Marketing", "Engineering", "Design", "Marketing"),
    stringsAsFactors = FALSE
  )

  # dplyr pipeline
  summary_stats <- users %>%
    group_by(department) %>%
    summarise(
      avg_score = mean(score),
      max_score = max(score),
      count = n()
    ) %>%
    arrange(desc(avg_score))

  # Function definition
  calculate_grade <- function(score) {
    case_when(
      score >= 90 ~ "A",
      score >= 80 ~ "B",
      score >= 70 ~ "C",
      TRUE ~ "F"
    )
  }

  users <- users %>%
    mutate(grade = calculate_grade(score))

  # Plot
  ggplot(users, aes(x = name, y = score, fill = department)) +
    geom_col() +
    labs(title = "User Scores", x = "Name", y = "Score") +
    theme_minimal() +
    scale_fill_brewer(palette = "Set2")

  print(summary_stats)
`;

// =============================================================================
// 27. Dart
// =============================================================================
const dartExample = dart`
  import 'dart:async';
  import 'dart:convert';

  class User {
    final int id;
    final String name;
    final String email;

    const User({required this.id, required this.name, required this.email});

    factory User.fromJson(Map<String, dynamic> json) {
      return User(
        id: json['id'] as int,
        name: json['name'] as String,
        email: json['email'] as String,
      );
    }

    Map<String, dynamic> toJson() => {
      'id': id,
      'name': name,
      'email': email,
    };

    @override
    String toString() => 'User($id: $name)';
  }

  Future<List<User>> fetchUsers() async {
    final response = await http.get(Uri.parse('https://api.example.com/users'));
    if (response.statusCode == 200) {
      final List<dynamic> data = jsonDecode(response.body);
      return data.map((json) => User.fromJson(json)).toList();
    }
    throw Exception('Failed to load users');
  }

  void main() async {
    try {
      final users = await fetchUsers();
      for (final user in users) {
        print(user);
      }
      final names = users.map((u) => u.name).where((n) => n.length > 3);
      print('Filtered: \${names.join(", ")}');
    } catch (e) {
      print('Error: $e');
    }
  }
`;

// =============================================================================
// 28. Swift
// =============================================================================
const swiftExample = swift`
  import Foundation

  struct User: Codable, CustomStringConvertible {
      let id: Int
      let name: String
      let email: String
      var isActive: Bool = true

      var description: String {
          "User(\\(id): \\(name))"
      }
  }

  protocol Repository {
      associatedtype Entity
      func findById(_ id: Int) async throws -> Entity?
      func findAll() async throws -> [Entity]
  }

  actor UserRepository: Repository {
      typealias Entity = User
      private var store: [Int: User] = [:]

      func findById(_ id: Int) async throws -> User? {
          store[id]
      }

      func findAll() async throws -> [User] {
          Array(store.values).sorted { $0.name < $1.name }
      }

      func add(_ user: User) {
          store[user.id] = user
      }
  }

  // Pattern matching with enums
  enum Result<T> {
      case success(T)
      case failure(Error)

      var value: T? {
          switch self {
          case .success(let v): return v
          case .failure: return nil
          }
      }
  }

  @main
  struct App {
      static func main() async {
          let repo = UserRepository()
          await repo.add(User(id: 1, name: "Alice", email: "alice@example.com"))

          if let user = try? await repo.findById(1) {
              print("Found: \\(user)")
          }
      }
  }
`;

// =============================================================================
// 29. Kotlin
// =============================================================================
const kotlinExample = kotlin`
  package com.example.app

  import kotlinx.coroutines.*

  data class User(
      val id: Int,
      val name: String,
      val email: String,
      val roles: List<String> = emptyList()
  )

  interface UserRepository {
      suspend fun findById(id: Int): User?
      suspend fun findAll(): List<User>
  }

  class InMemoryUserRepository : UserRepository {
      private val users = mutableMapOf<Int, User>()

      override suspend fun findById(id: Int): User? = users[id]

      override suspend fun findAll(): List<User> =
          users.values.sortedBy { it.name }

      fun add(user: User) {
          users[user.id] = user
      }
  }

  // Extension functions
  fun User.isAdmin(): Boolean = "admin" in roles
  fun List<User>.admins(): List<User> = filter { it.isAdmin() }

  // Sealed class for results
  sealed class Result<out T> {
      data class Success<T>(val data: T) : Result<T>()
      data class Error(val message: String) : Result<Nothing>()
  }

  fun main() = runBlocking {
      val repo = InMemoryUserRepository()
      repo.add(User(1, "Alice", "alice@example.com", listOf("admin")))
      repo.add(User(2, "Bob", "bob@example.com"))

      val admins = repo.findAll().admins()
      admins.forEach { println("Admin: \${it.name}") }

      // When expression
      val result: Result<User> = Result.Success(repo.findAll().first())
      when (result) {
          is Result.Success -> println("Got: \${result.data}")
          is Result.Error -> println("Error: \${result.message}")
      }
  }
`;

// =============================================================================
// 30. Dockerfile
// =============================================================================
const dockerfileExample = dockerfile`
  FROM node:20-alpine AS builder

  WORKDIR /app

  # Install dependencies first for layer caching
  COPY package.json package-lock.json ./
  RUN npm ci --production=false

  COPY tsconfig.json ./
  COPY src/ ./src/

  RUN npm run build && npm prune --production

  # Production stage
  FROM node:20-alpine AS runner

  LABEL maintainer="team@example.com"
  LABEL version="1.0.0"

  ENV NODE_ENV=production
  ENV PORT=3000

  RUN addgroup --system app && adduser --system --ingroup app app

  WORKDIR /app

  COPY --from=builder --chown=app:app /app/dist ./dist
  COPY --from=builder --chown=app:app /app/node_modules ./node_modules
  COPY --from=builder --chown=app:app /app/package.json ./

  USER app

  EXPOSE 3000

  HEALTHCHECK --interval=30s --timeout=3s --retries=3 \\
    CMD wget --quiet --tries=1 --spider http://localhost:3000/health || exit 1

  CMD ["node", "dist/server.js"]
`;

// =============================================================================
// 31. INI
// =============================================================================
const iniExample = ini`
  ; Application Configuration
  [app]
  name = MyApplication
  version = 2.1.0
  debug = false
  log_level = info

  [database]
  host = localhost
  port = 5432
  name = myapp_production
  user = dbadmin
  password = s3cret!
  pool_size = 20
  ssl = true

  [redis]
  host = 127.0.0.1
  port = 6379
  db = 0
  ttl = 3600

  [email]
  smtp_host = smtp.example.com
  smtp_port = 587
  from = noreply@example.com
  use_tls = true

  ; Feature flags
  [features]
  dark_mode = true
  beta_access = false
  max_upload_mb = 50
`;

// =============================================================================
// 32. TOML
// =============================================================================
const tomlExample = toml`
  [package]
  name = "my-project"
  version = "0.1.0"
  edition = "2024"
  authors = ["Alice <alice@example.com>"]
  description = "A sample project"

  [dependencies]
  serde = { version = "1.0", features = ["derive"] }
  tokio = { version = "1", features = ["full"] }
  axum = "0.7"
  sqlx = { version = "0.7", features = ["postgres", "runtime-tokio"] }

  [dev-dependencies]
  criterion = "0.5"
  mockall = "0.12"

  [profile.release]
  opt-level = 3
  lto = true
  strip = true

  [[bin]]
  name = "server"
  path = "src/main.rs"

  [workspace]
  members = ["crates/*"]

  [features]
  default = ["json"]
  json = ["serde_json"]
  full = ["json", "yaml", "toml"]
`;

// =============================================================================
// 33. Regex
// =============================================================================
const regexExample = regex`
  ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$
`;

// =============================================================================
// 34. PowerShell
// =============================================================================
const powershellExample = powershell`
  #Requires -Version 7.0

  param(
      [Parameter(Mandatory)]
      [string]$Environment,

      [ValidateRange(1, 100)]
      [int]$MaxRetries = 3
  )

  Set-StrictMode -Version Latest
  $ErrorActionPreference = 'Stop'

  class AppConfig {
      [string]$Name
      [string]$Version
      [hashtable]$Settings

      [string] ToString() {
          return "$($this.Name) v$($this.Version)"
      }
  }

  function Get-UserInfo {
      [CmdletBinding()]
      param(
          [Parameter(ValueFromPipeline)]
          [string[]]$UserName
      )

      process {
          foreach ($name in $UserName) {
              [PSCustomObject]@{
                  Name      = $name
                  Exists    = Test-Path "C:\\Users\\$name"
                  Timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
              }
          }
      }
  }

  # Pipeline usage
  $users = @('Alice', 'Bob', 'Charlie') |
      Get-UserInfo |
      Where-Object { $_.Exists } |
      Sort-Object Name

  # Splatting
  $params = @{
      Path        = "C:\\Logs\\$Environment"
      Filter      = '*.log'
      Recurse     = $true
      ErrorAction = 'SilentlyContinue'
  }

  $logFiles = Get-ChildItem @params |
      Where-Object { $_.LastWriteTime -gt (Get-Date).AddDays(-7) }

  Write-Host "Found $($logFiles.Count) recent log files" -ForegroundColor Green
`;
