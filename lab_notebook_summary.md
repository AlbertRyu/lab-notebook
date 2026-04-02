# Lab Notebook — 技术摘要

## 项目定位

单人维护的科研样品知识库，供他人只读查看。核心功能是**以样品为中心的实验记录查询系统**，无需认证。

---

## 技术栈

- **后端**：FastAPI + SQLite（通过 SQLModel 或 sqlite3）
- **前端**：单页应用，Alpine.js 或纯 JS + Plotly.js（交互式图表）
- **部署**：Raspberry Pi 5，Docker Compose，Cloudflare Tunnel
- **数据解析**：复用 vsm_visualizer 现有解析逻辑

---

## 数据模型

### 数据库 Schema

```sql
samples     (id, name, compound, synthesis_date, batch, box, crystal_size, notes)
            -- box: 可选，实体归档盒子号，每盒唯一对应一个样品
experiments (id, sample_id, type, date, notes)
            -- type: microscopy | pxrd | ppms | fmr （可扩展）
files       (id, experiment_id, filename, path, file_type)
            -- file_type: image | data | screenshot
```

### 目录结构

```
data/
└── samples/
    └── 4Br-Mn-BA-001/
        ├── meta.yaml
        ├── microscopy/
        ├── pxrd/
        ├── ppms/
        └── fmr/
```

### meta.yaml 格式

```yaml
name: 4Br-Mn-BA-001
compound: 4Br-Mn-BA
synthesis_date: 2024-10-15
batch: B3
box: "A-03"           # 可选，实体归档盒子号，每盒唯一对应一个样品
crystal_size: "0.5 x 0.3 x 0.1 mm"
notes: "..."
```

---

## 核心功能

### 数据录入（两种方式）

1. **文件夹扫描导入**：按目录结构放文件，后端扫描 `meta.yaml` 自动建立记录，用于批量导入
2. **表单录入**：网页前端填表上传，用于新实验数据

### 查询与展示

- 样品列表页：支持按 `compound`、`batch`、`box` 过滤和搜索
- 样品详情页：显示所有实验记录，按仪器类型分组
- 图片画廊：显微镜图、截图等
- 交互式图表：PXRD、PPMS、FMR 数据由后端解析，返回 JSON，Plotly.js 前端渲染

### 部署

- 与现有 recipe app 同一个 Docker Compose 栈
- 通过 Cloudflare Tunnel 对外暴露，无认证

---

## 开发顺序

1. 后端骨架（FastAPI + SQLite，基本 CRUD）
2. 文件夹扫描导入逻辑
3. 前端样品列表 + 详情页
4. 可视化集成（接入现有解析逻辑）
5. 表单录入
