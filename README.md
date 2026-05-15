# MBE 外延结构管理

本地单机网页工具，用 SQLite 保存外延片、普通层、重复块和模板数据。第一版使用 Python 标准库后端和原生 HTML/CSS/JS 前端，不需要安装第三方依赖。

## 启动

```bash
python3 server.py
```

浏览器打开：

```text
http://127.0.0.1:8765
```

数据库默认保存在：

```text
data/mbe.sqlite
```

## 导入现有 Excel

页面左侧可以直接点击 `导入片号N*.xlsx`。也可以命令行导入：

```bash
python3 server.py import-excel
```

默认导入目录：

```text
/Users/hahahaha/Library/CloudStorage/OneDrive-个人/Postgraduate File/杂项/外延表格-含样片结构统计/外延结构统计
```

## 已支持

- 新建、搜索、编辑、复制整片外延结构
- 添加普通层和重复块，重复块可添加子层
- 层或结构块复制、粘贴、上移、下移、删除
- 掺杂浓度自由文本，不填或旧表中的 `0` 视为不掺杂
- 生长温度和备注字段
- QD 层可标记为显示但不计入厚度
- 右侧厚度比例结构图、重复块样式、掺杂标记
- 总厚度、材料总厚度、掺杂层数量统计
- JSON/CSV 导出

