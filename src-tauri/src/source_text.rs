//! One decoding contract for source display, tree-sitter and card-source lookup.
//! UTF-8 first, explicit UTF-16 BOMs, then strict Windows GBK (CP936).
//! Existing files retain their encoding on save; conversion errors never truncate them.

use std::io::{self, ErrorKind};
use std::path::Path;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Encoding {
    Utf8,
    Utf8Bom,
    Utf16Le,
    Utf16Be,
    Gbk,
}

fn invalid(message: impl Into<String>) -> io::Error {
    io::Error::new(ErrorKind::InvalidData, message.into())
}

fn decode(bytes: &[u8]) -> io::Result<(String, Encoding)> {
    if bytes.starts_with(&[0xff, 0xfe, 0, 0]) || bytes.starts_with(&[0, 0, 0xfe, 0xff]) {
        return Err(invalid("UTF-32 source files are not supported"));
    }
    let (text, encoding) = if let Some(body) = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]) {
        let text = std::str::from_utf8(body).map_err(|_| invalid("Invalid UTF-8 BOM source"))?;
        (text.to_owned(), Encoding::Utf8Bom)
    } else if bytes.starts_with(&[0xff, 0xfe]) || bytes.starts_with(&[0xfe, 0xff]) {
        if bytes.len() % 2 != 0 {
            return Err(invalid("Truncated UTF-16 source"));
        }
        let little = bytes[0] == 0xff;
        let units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|pair| {
                if little {
                    u16::from_le_bytes([pair[0], pair[1]])
                } else {
                    u16::from_be_bytes([pair[0], pair[1]])
                }
            })
            .collect();
        let text = String::from_utf16(&units).map_err(|_| invalid("Invalid UTF-16 source"))?;
        (
            text,
            if little {
                Encoding::Utf16Le
            } else {
                Encoding::Utf16Be
            },
        )
    } else if let Ok(text) = std::str::from_utf8(bytes) {
        (text.to_owned(), Encoding::Utf8)
    } else {
        let text = decode_gbk(bytes)?;
        // Do not silently replace bytes or accept a non-reversible conversion.
        if encode_gbk(&text)? != bytes {
            return Err(invalid(
                "Source is not losslessly decodable as UTF-8 or GBK",
            ));
        }
        (text, Encoding::Gbk)
    };
    if text.contains('\0') {
        return Err(invalid(
            "Source contains NUL bytes; check the file encoding",
        ));
    }
    Ok((text, encoding))
}

fn encode(text: &str, encoding: Encoding) -> io::Result<Vec<u8>> {
    if text.contains('\0') {
        return Err(invalid("Source contains NUL characters"));
    }
    match encoding {
        Encoding::Utf8 => Ok(text.as_bytes().to_vec()),
        Encoding::Utf8Bom => {
            let mut bytes = vec![0xef, 0xbb, 0xbf];
            bytes.extend_from_slice(text.as_bytes());
            Ok(bytes)
        }
        Encoding::Utf16Le | Encoding::Utf16Be => {
            let little = encoding == Encoding::Utf16Le;
            let mut bytes = if little {
                vec![0xff, 0xfe]
            } else {
                vec![0xfe, 0xff]
            };
            for unit in text.encode_utf16() {
                bytes.extend_from_slice(&if little {
                    unit.to_le_bytes()
                } else {
                    unit.to_be_bytes()
                });
            }
            Ok(bytes)
        }
        Encoding::Gbk => encode_gbk(text),
    }
}

pub fn read_source(path: &Path) -> io::Result<String> {
    let bytes = std::fs::read(path)?;
    decode(&bytes)
        .map(|(text, _)| text)
        .map_err(|error| invalid(format!("Cannot decode source {}: {error}", path.display())))
}

pub fn write_source(path: &Path, text: &str) -> io::Result<()> {
    let encoding = match std::fs::read(path) {
        Ok(bytes) => decode(&bytes)?.1,
        Err(error) if error.kind() == ErrorKind::NotFound => Encoding::Utf8,
        Err(error) => return Err(error),
    };
    // Complete strict encoding before opening/truncating the destination.
    let bytes = encode(text, encoding)?;
    std::fs::write(path, bytes)
}

#[cfg(windows)]
fn decode_gbk(bytes: &[u8]) -> io::Result<String> {
    use windows::Win32::Globalization::{MultiByteToWideChar, MB_ERR_INVALID_CHARS};
    if bytes.is_empty() {
        return Ok(String::new());
    }
    i32::try_from(bytes.len()).map_err(|_| invalid("Source exceeds Windows decoder size limit"))?;
    // Slices provide valid buffers; Win32 sizes are checked before the wrapper conversion.
    let length = unsafe { MultiByteToWideChar(936, MB_ERR_INVALID_CHARS, bytes, None) };
    if length == 0 {
        return Err(invalid("Source is neither valid UTF-8 nor GBK (CP936)"));
    }
    let mut wide = vec![0u16; length as usize];
    let written = unsafe { MultiByteToWideChar(936, MB_ERR_INVALID_CHARS, bytes, Some(&mut wide)) };
    if written != length {
        return Err(io::Error::last_os_error());
    }
    String::from_utf16(&wide).map_err(|_| invalid("Invalid GBK source"))
}

#[cfg(windows)]
fn encode_gbk(text: &str) -> io::Result<Vec<u8>> {
    use windows::core::PCSTR;
    use windows::Win32::Globalization::{WideCharToMultiByte, WC_NO_BEST_FIT_CHARS};
    if text.is_empty() {
        return Ok(Vec::new());
    }
    let wide: Vec<u16> = text.encode_utf16().collect();
    i32::try_from(wide.len()).map_err(|_| invalid("Source exceeds Windows encoder size limit"))?;
    let length =
        unsafe { WideCharToMultiByte(936, WC_NO_BEST_FIT_CHARS, &wide, None, PCSTR::null(), None) };
    if length == 0 {
        return Err(io::Error::last_os_error());
    }
    let mut bytes = vec![0u8; length as usize];
    let written = unsafe {
        WideCharToMultiByte(
            936,
            WC_NO_BEST_FIT_CHARS,
            &wide,
            Some(&mut bytes),
            PCSTR::null(),
            None,
        )
    };
    if written != length {
        return Err(io::Error::last_os_error());
    }
    if decode_gbk(&bytes)? != text {
        return Err(invalid("Edited text cannot be saved as GBK without losing characters; original file was not modified"));
    }
    Ok(bytes)
}

#[cfg(not(windows))]
fn decode_gbk(_: &[u8]) -> io::Result<String> {
    Err(invalid(
        "GBK source decoding requires the Windows desktop runtime",
    ))
}

#[cfg(not(windows))]
fn encode_gbk(_: &str) -> io::Result<Vec<u8>> {
    Err(invalid(
        "GBK source encoding requires the Windows desktop runtime",
    ))
}
