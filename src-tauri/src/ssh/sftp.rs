// src-tauri/src/ssh/sftp.rs

use ssh2::{FileStat, Sftp};
use std::path::Path;

/// SFTP文件信息
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SftpEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub permissions: u32,
    pub modified: String,
    pub owner: String,
    pub group: String,
}

/// 列出目录内容
pub fn list_dir(sftp: &Sftp, path: &str) -> Result<Vec<SftpEntry>, String> {
    let mut entries = Vec::new();

    let mut dir = sftp.opendir(Path::new(path))
        .map_err(|e| format!("打开目录失败: {}", e))?;

    loop {
        match dir.readdir() {
            Ok((filename, attrs)) => {
                let name = filename.to_string_lossy().to_string();

                // 跳过 . 和 ..
                if name == "." || name == ".." {
                    continue;
                }

                let full_path = if path.ends_with('/') {
                    format!("{}{}", path, name)
                } else {
                    format!("{}/{}", path, name)
                };

                let is_dir = attrs.is_dir();
                let size = attrs.size.unwrap_or(0);
                let permissions = attrs.perm.unwrap_or(0);
                let modified = attrs.mtime
                    .map(|t| {
                        chrono::DateTime::from_timestamp(t as i64, 0)
                            .map(|dt| dt.format("%Y-%m-%d %H:%M").to_string())
                            .unwrap_or_default()
                    })
                    .unwrap_or_default();

                let (owner, group) = if let Some(uid) = attrs.uid {
                    if let Some(gid) = attrs.gid {
                        (uid.to_string(), gid.to_string())
                    } else {
                        (uid.to_string(), String::new())
                    }
                } else {
                    (String::new(), String::new())
                };

                entries.push(SftpEntry {
                    name,
                    path: full_path,
                    is_dir,
                    size,
                    permissions,
                    modified,
                    owner,
                    group,
                });
            }
            Err(_) => break, // 读取完毕
        }
    }

    // 排序：目录在前，然后按名称排序
    entries.sort_by(|a, b| {
        if a.is_dir && !b.is_dir {
            std::cmp::Ordering::Less
        } else if !a.is_dir && b.is_dir {
            std::cmp::Ordering::Greater
        } else {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        }
    });

    Ok(entries)
}

/// 创建目录
pub fn mkdir(sftp: &Sftp, path: &str) -> Result<(), String> {
    sftp.mkdir(Path::new(path), 0o755)
        .map_err(|e| format!("创建目录失败: {}", e))
}

/// 删除文件
pub fn remove_file(sftp: &Sftp, path: &str) -> Result<(), String> {
    sftp.unlink(Path::new(path))
        .map_err(|e| format!("删除文件失败: {}", e))
}

/// 删除目录
pub fn remove_dir(sftp: &Sftp, path: &str) -> Result<(), String> {
    sftp.rmdir(Path::new(path))
        .map_err(|e| format!("删除目录失败: {}", e))
}

/// 重命名
pub fn rename(sftp: &Sftp, old: &str, new: &str) -> Result<(), String> {
    sftp.rename(Path::new(old), Path::new(new), None)
        .map_err(|e| format!("重命名失败: {}", e))
}

/// 修改权限
pub fn chmod(sftp: &Sftp, path: &str, mode: i32) -> Result<(), String> {
    let stat = FileStat {
        size: None,
        uid: None,
        gid: None,
        perm: Some(mode as u32),
        atime: None,
        mtime: None,
    };
    sftp.setstat(Path::new(path), stat)
        .map_err(|e| format!("修改权限失败: {}", e))
}

/// 读取文件内容
pub fn read_file(sftp: &Sftp, path: &str) -> Result<String, String> {
    let mut file = sftp.open(Path::new(path))
        .map_err(|e| format!("打开文件失败: {}", e))?;

    let mut content = String::new();
    std::io::Read::read_to_string(&mut file, &mut content)
        .map_err(|e| format!("读取文件失败: {}", e))?;

    Ok(content)
}

/// 写入文件内容
pub fn write_file(sftp: &Sftp, path: &str, content: &str) -> Result<(), String> {
    let mut file = sftp.create(Path::new(path))
        .map_err(|e| format!("创建文件失败: {}", e))?;

    std::io::Write::write_all(&mut file, content.as_bytes())
        .map_err(|e| format!("写入文件失败: {}", e))?;

    Ok(())
}
