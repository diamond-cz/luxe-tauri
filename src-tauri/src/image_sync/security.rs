//! Explicit current-user DACL. Never fall back to the process's default pipe ACL.
use std::{ffi::c_void, mem::size_of};
use tokio::net::windows::named_pipe::{NamedPipeServer, ServerOptions};
use windows::{
    core::{PCWSTR, PWSTR},
    Win32::{
        Foundation::{CloseHandle, LocalFree, HANDLE, HLOCAL},
        Security::{
            Authorization::{
                ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
                SDDL_REVISION_1,
            },
            GetTokenInformation, TokenUser, PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES, TOKEN_QUERY,
            TOKEN_USER,
        },
        System::Threading::{GetCurrentProcess, OpenProcessToken},
    },
};

struct Token(HANDLE);
impl Drop for Token {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}
struct LocalAllocation(*mut c_void);
impl Drop for LocalAllocation {
    fn drop(&mut self) {
        unsafe {
            let _ = LocalFree(Some(HLOCAL(self.0)));
        }
    }
}

fn current_user_descriptor() -> windows::core::Result<LocalAllocation> {
    // API allocations have RAII ownership, including every early-return error path.
    unsafe {
        let mut handle = HANDLE::default();
        OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut handle)?;
        let token = Token(handle);
        let mut required = 0;
        let _ = GetTokenInformation(token.0, TokenUser, None, 0, &mut required);
        if required < size_of::<TOKEN_USER>() as u32 || required > 64 * 1024 {
            return Err(windows::core::Error::from_win32());
        }
        // usize storage provides TOKEN_USER alignment on Windows x64.
        let mut storage = vec![0usize; (required as usize).div_ceil(size_of::<usize>())];
        GetTokenInformation(
            token.0,
            TokenUser,
            Some(storage.as_mut_ptr().cast()),
            required,
            &mut required,
        )?;
        let user = &*storage.as_ptr().cast::<TOKEN_USER>();
        let mut sid = PWSTR::null();
        ConvertSidToStringSidW(user.User.Sid, &mut sid)?;
        let _sid_allocation = LocalAllocation(sid.0.cast());
        let sddl = format!("D:P(A;;GA;;;{})", sid.to_string()?);
        let wide = sddl.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
        let mut descriptor = PSECURITY_DESCRIPTOR::default();
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            PCWSTR(wide.as_ptr()),
            SDDL_REVISION_1,
            &mut descriptor,
            None,
        )?;
        Ok(LocalAllocation(descriptor.0))
    }
}

pub fn create_private_pipe(
    options: &ServerOptions,
    name: &str,
) -> std::io::Result<NamedPipeServer> {
    let descriptor = current_user_descriptor().map_err(std::io::Error::other)?;
    let mut attributes = SECURITY_ATTRIBUTES {
        nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: descriptor.0,
        bInheritHandle: false.into(),
    };
    // Tokio consumes the attributes synchronously; descriptor remains alive for the call.
    unsafe {
        options.create_with_security_attributes_raw(
            name,
            (&mut attributes as *mut SECURITY_ATTRIBUTES).cast(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn current_user_can_connect_to_private_pipe() {
        let name = format!(r"\\.\pipe\luxe-image-sync-acl-test-{}", std::process::id());
        let server = create_private_pipe(&ServerOptions::new(), &name).unwrap();
        let _client = tokio::net::windows::named_pipe::ClientOptions::new()
            .open(&name)
            .unwrap();
        server.connect().await.unwrap();
    }
}
