#[cfg(target_os = "macos")]
use std::ffi::{c_void, CStr};
#[cfg(target_os = "macos")]
use std::ptr::NonNull;

#[cfg(target_os = "macos")]
use base64::engine::general_purpose::STANDARD as BASE64;
#[cfg(target_os = "macos")]
use base64::Engine;
#[cfg(target_os = "macos")]
use objc2::AnyThread;
#[cfg(target_os = "macos")]
use objc2::rc::Retained;
#[cfg(target_os = "macos")]
use objc2::runtime::Bool;
#[cfg(target_os = "macos")]
use objc2_foundation::{
    NSData, NSError, NSString, NSURL, NSURLBookmarkCreationOptions, NSURLBookmarkResolutionOptions,
    NSUInteger,
};

#[cfg(target_os = "macos")]
fn nsstring_to_string(value: &NSString) -> String {
    unsafe {
        let ptr = value.UTF8String();
        if ptr.is_null() {
            String::new()
        } else {
            CStr::from_ptr(ptr).to_string_lossy().into_owned()
        }
    }
}

#[cfg(target_os = "macos")]
fn error_to_string(error: Retained<NSError>) -> String {
    let description = error.localizedDescription();
    nsstring_to_string(&description)
}

#[cfg(target_os = "macos")]
fn nsdata_to_vec(data: &NSData) -> Vec<u8> {
    let length = data.length() as usize;
    if length == 0 {
        return Vec::new();
    }
    let mut buffer = vec![0u8; length];
    unsafe {
        let ptr = NonNull::new_unchecked(buffer.as_mut_ptr() as *mut c_void);
        data.getBytes_length(ptr, length as NSUInteger);
    }
    buffer
}

#[cfg(target_os = "macos")]
fn data_from_bytes(bytes: &[u8]) -> Result<Retained<NSData>, String> {
    let data = unsafe {
        NSData::initWithBytes_length(
            NSData::alloc(),
            bytes.as_ptr() as *const c_void,
            bytes.len() as NSUInteger,
        )
    };
    Ok(data)
}

#[cfg(target_os = "macos")]
pub fn url_path(url: &NSURL) -> Option<String> {
    url.path().map(|p| nsstring_to_string(&p))
}

#[cfg(target_os = "macos")]
pub fn create_security_scoped_bookmark(url: &NSURL) -> Result<String, String> {
    let data = url
        .bookmarkDataWithOptions_includingResourceValuesForKeys_relativeToURL_error(
            NSURLBookmarkCreationOptions::WithSecurityScope,
            None,
            None,
        )
        .map_err(error_to_string)?;

    let bytes = nsdata_to_vec(&data);
    Ok(BASE64.encode(bytes))
}

#[cfg(target_os = "macos")]
pub fn start_access_from_bookmark(bookmark_b64: &str) -> Result<String, String> {
    let decoded = BASE64
        .decode(bookmark_b64)
        .map_err(|err| format!("无法解析书签: {err}"))?;
    let ns_data = data_from_bytes(&decoded)?;

    let mut is_stale = Bool::NO;
    let resolved = unsafe {
        NSURL::URLByResolvingBookmarkData_options_relativeToURL_bookmarkDataIsStale_error(
            &ns_data,
            NSURLBookmarkResolutionOptions::WithSecurityScope,
            None,
            &mut is_stale,
        )
    }
    .map_err(error_to_string)?;

    let started = unsafe { resolved.startAccessingSecurityScopedResource() };
    if !started {
        return Err("无法开启 security scoped 访问权限".to_string());
    }

    url_path(&resolved).ok_or_else(|| "解析到的路径无效".to_string())
}
