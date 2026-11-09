// Verify test-service signatures with the actual Chromium implementations.
#include <iostream>
#include <string>
#include <vector>

#include "base/containers/span.h"
#include "base/files/file_path.h"
#include "base/files/file_util.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/string_util.h"
#include "components/client_update_protocol/cup.h"
#include "components/crx_file/crx_verifier.h"
#include "third_party/zlib/google/zip.h"

int main(int argc, char** argv) {
  if (argc == 4 && std::string(argv[1]) == "unzip") {
    const auto output = base::FilePath::FromUTF8Unsafe(argv[3]);
    if (base::PathExists(output) || !base::CreateDirectory(output)) {
      return 2;
    }
    return zip::Unzip(base::FilePath::FromUTF8Unsafe(argv[2]), output, {},
                      zip::UnzipSymlinkOption::PRESERVE) ? 0 : 1;
  }
  if (argc == 6 && std::string(argv[1]) == "cup") {
    std::string spki, request, response, proof;
    if (!base::ReadFileToString(base::FilePath::FromUTF8Unsafe(argv[2]), &spki) ||
        !base::ReadFileToString(base::FilePath::FromUTF8Unsafe(argv[3]), &request) ||
        !base::ReadFileToString(base::FilePath::FromUTF8Unsafe(argv[4]), &response) ||
        !base::ReadFileToString(base::FilePath::FromUTF8Unsafe(argv[5]), &proof)) {
      return 2;
    }
    client_update_protocol::Cup cup(1, base::as_byte_span(spki));
    cup.PrepareRequestParameters(request);
    cup.OverrideNonceForTesting(1, 12345);
    base::TrimWhitespaceASCII(proof, base::TRIM_ALL, &proof);
    return cup.ValidateResponse(response, proof) ? 0 : 1;
  }
  if (argc == 4 && std::string(argv[1]) == "crx") {
    std::vector<uint8_t> hash;
    if (!base::HexStringToBytes(argv[3], &hash) || hash.size() != 32) {
      return 2;
    }
    const auto result = crx_file::Verify(
        base::FilePath::FromUTF8Unsafe(argv[2]),
        crx_file::VerifierFormat::CRX3, {hash}, {}, nullptr, nullptr, nullptr);
    return result == crx_file::VerifierResult::OK_FULL ? 0 : 1;
  }
  std::cerr << "Usage: verify cup spki request response proof | crx file hash | unzip archive new-directory\n";
  return 2;
}
