
# Auth Service specifics goes HERE!

# INSIGHTS
  - Log out only clears the refresh token and makes it impossible to renew access token. However access token will still be valid until its own expiry. Therefore it is also important to dispose the accesstoken on the frontend as well on log out.
    - May optionally want to introduce a medium that keeps track of access token as well on backend.