// 通过 LaunchServices 查询 / 修改文件扩展名的默认打开程序。
// 仅 macOS。其他平台返回空结果。

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DefaultAppStatus {
    pub extension: String,
    pub bundle_id: Option<String>,
    pub is_self: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetDefaultResult {
    pub extension: String,
    pub success: bool,
    pub error_code: i32,
}

#[cfg(target_os = "macos")]
mod imp {
    use super::*;
    use core_foundation::base::TCFType;
    use core_foundation::string::{CFString, CFStringRef};

    #[link(name = "CoreServices", kind = "framework")]
    extern "C" {
        fn LSSetDefaultRoleHandlerForContentType(
            in_content_type: CFStringRef,
            in_role: u32,
            in_handler_bundle_id: CFStringRef,
        ) -> i32;
        fn LSCopyDefaultRoleHandlerForContentType(
            in_content_type: CFStringRef,
            in_role: u32,
        ) -> CFStringRef;
        fn UTTypeCreatePreferredIdentifierForTag(
            in_tag_class: CFStringRef,
            in_tag: CFStringRef,
            in_conforming_to_uti: CFStringRef,
        ) -> CFStringRef;
    }

    const K_LS_ROLES_ALL: u32 = 0xFFFF_FFFF;

    fn uti_for_extension(ext: &str) -> Option<CFString> {
        let tag_class = CFString::new("public.filename-extension");
        let tag = CFString::new(ext);
        unsafe {
            let uti_ref = UTTypeCreatePreferredIdentifierForTag(
                tag_class.as_concrete_TypeRef(),
                tag.as_concrete_TypeRef(),
                std::ptr::null(),
            );
            if uti_ref.is_null() {
                None
            } else {
                Some(CFString::wrap_under_create_rule(uti_ref))
            }
        }
    }

    fn default_handler_for_uti(uti: &CFString) -> Option<String> {
        unsafe {
            let bundle_ref =
                LSCopyDefaultRoleHandlerForContentType(uti.as_concrete_TypeRef(), K_LS_ROLES_ALL);
            if bundle_ref.is_null() {
                None
            } else {
                Some(CFString::wrap_under_create_rule(bundle_ref).to_string())
            }
        }
    }

    pub fn get_status(extensions: &[String], self_bundle_id: &str) -> Vec<DefaultAppStatus> {
        let self_lower = self_bundle_id.to_lowercase();
        extensions
            .iter()
            .map(|ext| {
                let bundle_id = uti_for_extension(ext).and_then(|uti| default_handler_for_uti(&uti));
                let is_self = bundle_id
                    .as_deref()
                    .map(|id| id.to_lowercase() == self_lower)
                    .unwrap_or(false);
                DefaultAppStatus {
                    extension: ext.clone(),
                    bundle_id,
                    is_self,
                }
            })
            .collect()
    }

    pub fn set_as_default(extensions: &[String], bundle_id: &str) -> Vec<SetDefaultResult> {
        let bundle = CFString::new(bundle_id);
        extensions
            .iter()
            .map(|ext| {
                if let Some(uti) = uti_for_extension(ext) {
                    let code = unsafe {
                        LSSetDefaultRoleHandlerForContentType(
                            uti.as_concrete_TypeRef(),
                            K_LS_ROLES_ALL,
                            bundle.as_concrete_TypeRef(),
                        )
                    };
                    SetDefaultResult {
                        extension: ext.clone(),
                        success: code == 0,
                        error_code: code,
                    }
                } else {
                    SetDefaultResult {
                        extension: ext.clone(),
                        success: false,
                        error_code: -1,
                    }
                }
            })
            .collect()
    }
}

#[tauri::command]
pub fn get_default_app_status(
    app: tauri::AppHandle,
    extensions: Vec<String>,
) -> Result<Vec<DefaultAppStatus>, String> {
    let _ = &app;
    #[cfg(target_os = "macos")]
    {
        let bundle_id = app.config().identifier.clone();
        Ok(imp::get_status(&extensions, &bundle_id))
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(extensions
            .into_iter()
            .map(|ext| DefaultAppStatus {
                extension: ext,
                bundle_id: None,
                is_self: false,
            })
            .collect())
    }
}

#[tauri::command]
pub fn set_as_default_app(
    app: tauri::AppHandle,
    extensions: Vec<String>,
) -> Result<Vec<SetDefaultResult>, String> {
    let _ = &app;
    #[cfg(target_os = "macos")]
    {
        let bundle_id = app.config().identifier.clone();
        Ok(imp::set_as_default(&extensions, &bundle_id))
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Only supported on macOS".to_string())
    }
}

