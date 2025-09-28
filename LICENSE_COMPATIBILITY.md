# License Compatibility Analysis for Control Center

## Summary

The Control Center project uses **AGPL-3.0** as its license. All dependencies use permissive licenses (MIT, BSD, Apache 2.0, ISC) that are **fully compatible** with AGPL-3.0. There are **no license compatibility issues**.

## License Compatibility Matrix

### Manager (Node.js) Dependencies

| Package | License | AGPL-3.0 Compatible | Notes |
|---------|---------|-------------------|-------|
| bcryptjs | MIT | ✅ Yes | Permissive, requires attribution |
| drawflow | MIT | ✅ Yes | Permissive, requires attribution |
| ejs | Apache-2.0 | ✅ Yes | Permissive with patent grant |
| express | MIT | ✅ Yes | Permissive, requires attribution |
| ini | ISC | ✅ Yes | Functionally equivalent to MIT |
| jsonwebtoken | MIT | ✅ Yes | Permissive, requires attribution |
| simple-git | MIT | ✅ Yes | Permissive, requires attribution |
| sqlite3 | BSD-3-Clause | ✅ Yes | Permissive with attribution |
| uuid | MIT | ✅ Yes | Permissive, requires attribution |
| ws | MIT | ✅ Yes | Permissive, requires attribution |

### Nodes (Go) Key Dependencies

| Package | License | AGPL-3.0 Compatible | Notes |
|---------|---------|-------------------|-------|
| golang.org/x/crypto | BSD-3-Clause | ✅ Yes | Official Go package |
| github.com/gorilla/websocket | BSD-2-Clause | ✅ Yes | Permissive |
| github.com/go-git/go-git/v5 | Apache-2.0 | ✅ Yes | Git implementation |
| github.com/gliderlabs/ssh | BSD-3-Clause | ✅ Yes | SSH server library |
| github.com/fsnotify/fsnotify | BSD-3-Clause | ✅ Yes | File watching |

## Important Notes

### For Users
- All dependencies use permissive licenses that allow commercial use
- No viral license effects from dependencies
- Users must comply with AGPL-3.0 when distributing the Control Center

### For Contributors
- New dependencies should preferably use MIT, BSD, Apache 2.0, or ISC licenses
- GPL-licensed dependencies (except LGPL with dynamic linking) should be avoided
- Always check license compatibility before adding new dependencies

### AGPL-3.0 Implications
1. **Network Use is Distribution**: Any network-accessible deployment must provide source code
2. **SaaS Protection**: Prevents competitors from offering proprietary SaaS versions
3. **Dual Licensing Option**: Commercial licenses can be offered for proprietary use
4. **Attribution Required**: Must maintain copyright notices and license text

## Verification Commands

To verify current dependency licenses:

```bash
# Node.js dependencies
cd manager
npx license-checker --summary

# Go dependencies
cd nodes
go-licenses check ./...  # Install: go install github.com/google/go-licenses@latest
```

## References
- [GNU AGPL-3.0 License](https://www.gnu.org/licenses/agpl-3.0.en.html)
- [License Compatibility Chart](https://www.gnu.org/licenses/license-compatibility.html)
- [SPDX License List](https://spdx.org/licenses/)